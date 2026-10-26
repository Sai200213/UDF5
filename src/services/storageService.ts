import { ref, uploadBytes, uploadBytesResumable, getDownloadURL, UploadTask, listAll, deleteObject, getMetadata, getBlob } from 'firebase/storage';
import { httpsCallable } from 'firebase/functions';
import { storage, functions, auth, ensureAuthenticated } from '../firebase/config';

/**
 * Recursively calculates the total storage consumption of a folder in bytes.
 * Tries the getStorageFolderSizeServer Cloud Function first (bypassing deny-all rules),
 * falling back to client-side listAll.
 */
export const getStorageFolderSize = async (folderPath: string): Promise<number> => {
    if (!folderPath) return 0;
    try {
        const getSizeFn = httpsCallable<{ folderPath: string }, { totalBytes: number }>(functions, 'getStorageFolderSizeServer');
        const res = await getSizeFn({ folderPath });
        if (res.data && typeof res.data.totalBytes === 'number') {
            return res.data.totalBytes;
        }
    } catch (cfErr) {
        // Fall back to client-side calculation
    }

    try {
        const folderRef = ref(storage, folderPath);
        const res = await listAll(folderRef);
        
        let totalSize = 0;
        const metadataPromises = res.items.map(async (itemRef) => {
            try {
                const meta = await getMetadata(itemRef);
                return meta.size;
            } catch (err) {
                console.error("Failed to get file metadata:", err);
                return 0;
            }
        });
        
        const sizes = await Promise.all(metadataPromises);
        totalSize += sizes.reduce((acc, curr) => acc + curr, 0);
        
        const subfolderPromises = res.prefixes.map(prefixRef => getStorageFolderSize(prefixRef.fullPath));
        const subfolderSizes = await Promise.all(subfolderPromises);
        totalSize += subfolderSizes.reduce((acc, curr) => acc + curr, 0);
        
        return totalSize;
    } catch (err: any) {
        if (err.code === 'storage/object-not-found') return 0;
        console.error(`Failed to calculate storage size for ${folderPath}:`, err);
        return 0;
    }
};


export interface FileCompressionOptions {
    skipCompression?: boolean;
    password?: string;
}

export const autoCompressFile = async (file: File, options?: FileCompressionOptions): Promise<File> => {
    if (options?.skipCompression) return file;

    if (file.type.startsWith('image/') && file.type !== 'image/gif') {
        try {
            // Document scans need high resolution and crisp quality (2400px max size, 0.90 quality)
            const compressed = await compressImage(file, 2400, 0.90);
            return compressed;
        } catch (e) {
            console.warn("[STORAGE] Image compression failed, uploading original:", e);
            return file;
        }
    }

    // PDF document compression (converts multi-page phone/scanner PDFs to optimized high-res Flate PDFs)
    if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        try {
            const { compressPdf } = await import('../utils/pdfCompression');
            return await compressPdf(file, { password: options?.password });
        } catch (e) {
            console.warn("[STORAGE] PDF compression failed, uploading original:", e);
            return file;
        }
    }

    return file;
};

/**
 * Uploads a file via a Cloud Function signed URL.
 * The Cloud Function validates ownership and returns a signed URL.
 * The file is then PUT to that URL directly — no storage rules involved.
 */
export const uploadViaSignedUrl = async (
    context: 'onboarding' | 'employee' | 'admin' | 'profile',
    storagePath: string,
    file: File,
    onProgress?: (percent: number) => void
): Promise<string> => {
    const getUploadUrlFn = httpsCallable<
        { context: string; storagePath: string; contentType: string; fileSize: number },
        { success: boolean; uploadUrl: string; storagePath: string }
    >(functions, 'getUploadUrl');

    const result = await getUploadUrlFn({
        context,
        storagePath,
        contentType: file.type || 'application/octet-stream',
        fileSize: file.size,
    });

    if (!result.data?.success || !result.data?.uploadUrl) {
        throw new Error('Failed to get upload URL from server.');
    }

    const { uploadUrl } = result.data;

    // Upload via fetch PUT to the signed URL (supports progress via XHR)
    await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', uploadUrl, true);
        xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');

        if (onProgress) {
            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) {
                    onProgress(Math.round((e.loaded / e.total) * 100));
                }
            };
        }

        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                resolve();
            } else {
                reject(new Error(`Upload failed: HTTP ${xhr.status}`));
            }
        };
        xhr.onerror = () => reject(new Error('Upload network error.'));
        xhr.send(file);
    });

    return storagePath;
};

/**
 * Basic file upload (no progress tracking).
 * Uses Cloud Function signed URLs to bypass storage rules restrictions.
 */
export const uploadFile = async (
    file: File,
    path: string,
    fileName?: string,
    options?: FileCompressionOptions
): Promise<string> => {
    try {
        const processedFile = await autoCompressFile(file, options);
        const finalName = fileName || `${Date.now()}_${processedFile.name}`;
        const cleanPath = path.replace(/\/+$/, '');
        const storagePath = `${cleanPath}/${finalName}`;

        // Determine context for Cloud Function signed URL:
        const context: 'onboarding' | 'employee' | 'admin' | 'profile' =
            storagePath.startsWith('onboarding/') ? 'onboarding' :
            storagePath.includes('/profile/') ? 'profile' :
            (storagePath.startsWith('public/') || storagePath.includes('/bgv/') || storagePath.includes('/disciplinary/')) ? 'admin' :
            'employee';

        try {
            return await uploadViaSignedUrl(context, storagePath, processedFile);
        } catch (cfErr) {
            console.warn('[STORAGE] Signed URL upload failed in uploadFile, attempting direct fallback:', cfErr);
            const storageRef = ref(storage, storagePath);
            const snapshot = await uploadBytes(storageRef, processedFile);
            return snapshot.ref.fullPath;
        }
    } catch (error) {
        console.error("Error uploading file:", error);
        throw error;
    }
};

const SIGNED_URL_CACHE_PREFIX = 'udf_signed_url_v1_';
const SIGNED_URL_TTL_MS = 25 * 60 * 1000; // 25 minutes

export const getCachedSignedUrl = (path: string): string | null => {
    if (typeof window === 'undefined') return null;
    try {
        const raw = sessionStorage.getItem(SIGNED_URL_CACHE_PREFIX + path);
        if (!raw) return null;
        const entry = JSON.parse(raw);
        if (entry && entry.url && typeof entry.expiresAt === 'number' && Date.now() < entry.expiresAt) {
            return entry.url;
        }
    } catch {}
    return null;
};

export const setCachedSignedUrl = (path: string, url: string): void => {
    if (typeof window === 'undefined' || !path || !url) return;
    try {
        sessionStorage.setItem(SIGNED_URL_CACHE_PREFIX + path, JSON.stringify({
            url,
            expiresAt: Date.now() + SIGNED_URL_TTL_MS
        }));
    } catch {}
};

/**
 * Resolves a secure storage path by downloading it as a blob and returning a local Object URL or signed URL.
 * Checks sessionStorage cache first, then calls getSecureDocumentURL Cloud Function.
 */
export const getSecureURL = async (storagePath: string | any): Promise<string> => {
    // Sanitize: extract storagePath from object if accidentally passed as {storagePath: '...'}
    let resolvedPath: string = typeof storagePath === 'object' && storagePath !== null && 'storagePath' in storagePath
        ? storagePath.storagePath
        : (typeof storagePath === 'string' ? storagePath : '');

    // If it's already an http/data/blob URL or empty, return it directly
    if (!resolvedPath || resolvedPath.startsWith('http') || resolvedPath.startsWith('data:') || resolvedPath.startsWith('blob:')) {
        return resolvedPath;
    }

    // 0. Check sessionStorage cache first (0ms latency!)
    const cached = getCachedSignedUrl(resolvedPath);
    if (cached) {
        return cached;
    }

    // Primary: Cloud Function getSecureDocumentURL (bypasses storage.rules deny-all)
    try {
        const getSecureDocFn = httpsCallable<{ storagePath: string }, { success: boolean; url: string }>(functions, 'getSecureDocumentURL');
        const result = await getSecureDocFn({ storagePath: resolvedPath });
        if (result.data?.success && result.data?.url) {
            setCachedSignedUrl(resolvedPath, result.data.url);
            return result.data.url;
        }
    } catch (cfError: any) {
        // Fall back to client getBlob if Cloud Function is unavailable
    }

    // Direct client-side getBlob fallback (if rules allow or admin)
    try {
        await ensureAuthenticated();
        const blob = await getBlob(ref(storage, resolvedPath));
        return URL.createObjectURL(blob);
    } catch (error: any) {
        // If file was not found under employees/ path, try resolving via onboarding/ path
        if (error?.code === 'storage/object-not-found' && resolvedPath.startsWith('employees/')) {
            const parts = resolvedPath.split('/');
            const joiningIdx = parts.indexOf('joining');
            if (joiningIdx !== -1 && joiningIdx < parts.length - 1) {
                const subPath = parts.slice(joiningIdx + 1).join('/');
                try {
                    const fallbackPath = `onboarding/${parts[1]}/${subPath}`;
                    const blobFallback = await getBlob(ref(storage, fallbackPath));
                    return URL.createObjectURL(blobFallback);
                } catch (e2) {
                    // continue
                }
            }
        }

        console.warn("Secure document unavailable at path:", resolvedPath);
        return '';
    }
};

/**
 * getBatchSignedURLs (CLOUD-8)
 * Fetches signed URLs for multiple paths in a single round-trip using getBatchSignedViewUrls Cloud Function.
 * Reads and updates the 25-minute sessionStorage cache to minimize cloud function cold starts.
 */
export const getBatchSignedURLs = async (storagePaths: (string | any)[]): Promise<Record<string, string>> => {
    const results: Record<string, string> = {};
    const uncachedPaths: string[] = [];

    for (const raw of storagePaths) {
        let p: string = typeof raw === 'object' && raw !== null && 'storagePath' in raw
            ? raw.storagePath
            : (typeof raw === 'string' ? raw : '');
        if (!p) continue;
        if (p.startsWith('http') || p.startsWith('data:') || p.startsWith('blob:')) {
            results[p] = p;
            continue;
        }
        const cached = getCachedSignedUrl(p);
        if (cached) {
            results[p] = cached;
        } else {
            uncachedPaths.push(p);
        }
    }

    if (uncachedPaths.length === 0) {
        return results;
    }

    // Process uncached paths in chunks of 25
    const CHUNK_SIZE = 25;
    const batchFn = httpsCallable<{ storagePaths: string[] }, { success: boolean; urls: Record<string, string> }>(
        functions,
        'getBatchSignedViewUrls'
    );

    for (let i = 0; i < uncachedPaths.length; i += CHUNK_SIZE) {
        const chunk = uncachedPaths.slice(i, i + CHUNK_SIZE);
        try {
            const resp = await batchFn({ storagePaths: chunk });
            if (resp.data?.success && resp.data.urls) {
                for (const [pathKey, signedUrl] of Object.entries(resp.data.urls)) {
                    if (signedUrl) {
                        results[pathKey] = signedUrl;
                        setCachedSignedUrl(pathKey, signedUrl);
                    }
                }
            }
        } catch (batchErr) {
            console.warn('[STORAGE] getBatchSignedURLs chunk error, falling back to sequential getSecureURL:', batchErr);
            await Promise.all(chunk.map(async (p) => {
                try {
                    const u = await getSecureURL(p);
                    if (u) results[p] = u;
                } catch {}
            }));
        }
    }

    return results;
};

/**
 * Downloads a file at storagePath as a Blob via getSecureDocumentURL signed URL,
 * with fallback to direct getBlob.
 */
export const getSecureBlob = async (storagePath: string | any): Promise<Blob> => {
    let resolvedPath: string = typeof storagePath === 'object' && storagePath !== null && 'storagePath' in storagePath
        ? storagePath.storagePath
        : (typeof storagePath === 'string' ? storagePath : '');

    if (!resolvedPath) {
        throw new Error('Empty storage path provided to getSecureBlob');
    }

    // If it's already a blob/http URL
    if (resolvedPath.startsWith('blob:') || resolvedPath.startsWith('http')) {
        const resp = await fetch(resolvedPath);
        if (!resp.ok) throw new Error(`HTTP error fetching blob: ${resp.status}`);
        return await resp.blob();
    }

    // 1. Try secure Cloud Function signed URL
    try {
        const getSecureDocFn = httpsCallable<{ storagePath: string }, { success: boolean; url: string }>(functions, 'getSecureDocumentURL');
        const result = await getSecureDocFn({ storagePath: resolvedPath });
        if (result.data?.success && result.data?.url) {
            const resp = await fetch(result.data.url);
            if (resp.ok) {
                return await resp.blob();
            }
        }
    } catch (cfErr) {
        console.warn('[STORAGE] getSecureBlob Cloud Function failed, falling back to direct getBlob:', cfErr);
    }

    // 2. Direct getBlob fallback
    await ensureAuthenticated();
    return await getBlob(ref(storage, resolvedPath));
};

/**
 * Safely revokes a client-side Blob URL created by getSecureURL to free browser memory.
 */
export const revokeSecureURL = (url?: string | null): void => {
    if (url && typeof url === 'string' && url.startsWith('blob:')) {
        try {
            URL.revokeObjectURL(url);
        } catch (e) {
            // Ignore if already revoked or invalid
        }
    }
};

/**
 * Upload a document with real-time progress tracking (resumable).
 * Used for joining form file uploads.
 * Falls back to direct upload if signed URL approach is unavailable.
 */
export const uploadDocumentWithProgress = async (
    file: File,
    path: string,
    onProgress?: (percent: number) => void,
    options?: FileCompressionOptions
): Promise<string> => {
    const processedFile = await autoCompressFile(file, options);
    return new Promise((resolve, reject) => {
        const storageRef = ref(storage, path);
        const uploadTask: UploadTask = uploadBytesResumable(storageRef, processedFile);

        uploadTask.on('state_changed',
            (snapshot) => {
                const percent = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
                onProgress?.(percent);
            },
            (error) => {
                console.error('[STORAGE] Upload error:', error);
                reject(error);
            },
            async () => {
                try {
                    resolve(uploadTask.snapshot.ref.fullPath);
                } catch (err) {
                    reject(err);
                }
            }
        );
    });
};


/**
 * Upload a submission document with progress.
 * Path: onboarding/{draftId or uid}/{fieldId}/{filename}
 * Uses Cloud Function signed URL — no storage rules involved.
 */
export const uploadSubmissionDocument = async (
    fieldId: string,
    file: File,
    onProgress?: (percent: number) => void,
    customFolder?: string,
    options?: FileCompressionOptions
): Promise<string> => {
    const processedFile = await autoCompressFile(file, options);
    const safeName = `${Date.now()}_${processedFile.name}`;

    let user = auth.currentUser;
    if (!user) {
        user = await ensureAuthenticated();
    }
    const uid = user?.uid;
    if (!uid) throw new Error('User must be authenticated to upload documents.');

    // Prefer customFolder, then active draft ID from session/local storage, then user UID
    let draftId: string | null = null;
    if (customFolder) {
        draftId = customFolder;
    } else if (typeof window !== 'undefined') {
        try {
            const raw = sessionStorage.getItem('onboarding_savedDraftId') || localStorage.getItem('onboarding_savedDraftId');
            if (raw) {
                draftId = typeof raw === 'string' && raw.startsWith('"') ? JSON.parse(raw) : raw;
            }
        } catch {}
    }
    const folderName = draftId || uid;
    const storagePath = `onboarding/${folderName}/${fieldId}/${safeName}`;

    try {
        // Primary: Cloud Function signed URL (no storage rules, no query limit)
        return await uploadViaSignedUrl('onboarding', storagePath, processedFile, onProgress);
    } catch (cfError) {
        console.warn('[STORAGE] Signed URL upload failed, falling back to direct upload:', cfError);
        // Fallback: Direct upload (works if storage rules permit)
        return uploadDocumentWithProgress(processedFile, storagePath, onProgress);
    }
};

export const uploadEmployeeDocument = async (
    employeeId: string,
    file: File,
    docType: string
) => {
    const storagePath = `employees/${employeeId}/joining/${docType}_${file.name}`;
    try {
        return await uploadViaSignedUrl('employee', storagePath, file);
    } catch (cfError) {
        console.warn('[STORAGE] Signed URL upload failed, falling back to direct upload:', cfError);
        return uploadFile(file, `employees/${employeeId}/joining`, `${docType}_${file.name}`);
    }
};

export const uploadSubmissionAttachment = async (
    submissionId: string,
    file: File
) => {
    // Use the current user's UID as the folder name to satisfy storage rules
    let user = auth.currentUser;
    if (!user) {
        user = await ensureAuthenticated();
    }
    const uid = user?.uid;
    if (!uid) throw new Error('User must be authenticated to upload documents.');
    return uploadFile(file, `onboarding/${uid}`);
};

/**
 * Upload a profile photo for a user (employee or staff).
 * Compresses the image client-side before uploading.
 */
export const uploadProfilePhoto = async (
    userId: string,
    file: File
): Promise<string> => {
    try {
        const compressed = await compressImage(file, 400, 0.8);
        const ext = file.name.split('.').pop() || 'jpg';
        const storagePath = `employees/${userId}/profile/avatar.${ext}`;
        try {
            return await uploadViaSignedUrl('profile', storagePath, compressed);
        } catch (cfError) {
            console.warn('[STORAGE] Signed URL upload failed, falling back to direct upload:', cfError);
            return uploadFile(compressed, `employees/${userId}/profile`, `avatar.${ext}`);
        }
    } catch (error) {
        console.error('Error uploading profile photo:', error);
        throw error;
    }
};

/**
 * Client-side image compression for fast avatar loading.
 */
function compressImage(file: File, maxSize: number, quality: number): Promise<File> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const reader = new FileReader();
        reader.onload = (e) => {
            img.src = e.target?.result as string;
        };
        img.onload = () => {
            const canvas = document.createElement('canvas');
            let { width, height } = img;
            if (width > height) {
                if (width > maxSize) { height = (height * maxSize) / width; width = maxSize; }
            } else {
                if (height > maxSize) { width = (width * maxSize) / height; height = maxSize; }
            }
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) return reject(new Error('Canvas not supported'));
            ctx.drawImage(img, 0, 0, width, height);
            canvas.toBlob(
                (blob) => {
                    const originalName = file.name;
                    const dotIndex = originalName.lastIndexOf('.');
                    const baseName = dotIndex !== -1 ? originalName.substring(0, dotIndex) : originalName;
                    const newName = `${baseName}.jpg`;
                    resolve(new File([blob], newName, { type: 'image/jpeg' }));
                },
                'image/jpeg',
                quality
            );
        };
        img.onerror = reject;
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}
/**
 * Safely deletes a single file in Firebase Storage.
 * Handles storage path string or object containing storagePath.
 * Calls deleteStoragePath Cloud Function to bypass storage.rules deny-all.
 */
export const deleteStorageFile = async (filePath: string | any): Promise<boolean> => {
    let resolvedPath: string = typeof filePath === 'object' && filePath !== null && 'storagePath' in filePath
        ? filePath.storagePath
        : (typeof filePath === 'string' ? filePath : '');

    // If full Firebase storage URL was passed, extract the storage path:
    if (resolvedPath.includes('firebasestorage.googleapis.com')) {
        const match = resolvedPath.match(/\/o\/([^?#]+)/);
        if (match && match[1]) {
            resolvedPath = decodeURIComponent(match[1]);
        }
    }

    // Skip empty or external/blob URLs
    if (!resolvedPath || resolvedPath.startsWith('http') || resolvedPath.startsWith('blob:') || resolvedPath.startsWith('data:')) {
        return false;
    }

    // 1. Try Cloud Function (Admin SDK on backend)
    try {
        const deleteFn = httpsCallable<{ storagePath: string; isFolder?: boolean }, { success: boolean }>(functions, 'deleteStoragePath');
        const res = await deleteFn({ storagePath: resolvedPath, isFolder: false });
        if (res.data?.success) {
            console.log(`[STORAGE] Deleted file via Cloud Function: ${resolvedPath}`);
            return true;
        }
    } catch (cfErr: any) {
        console.warn(`[STORAGE] deleteStoragePath Cloud Function error for ${resolvedPath}, trying client fallback:`, cfErr?.message || cfErr);
    }

    // 2. Client-side fallback
    try {
        await ensureAuthenticated();
        const fileRef = ref(storage, resolvedPath);
        await deleteObject(fileRef);
        console.log(`[STORAGE] Deleted file via client SDK: ${resolvedPath}`);
        return true;
    } catch (err: any) {
        if (err?.code === 'storage/object-not-found') {
            // Already deleted or doesn't exist
            return true;
        }
        console.warn(`[STORAGE] Failed to delete file at ${resolvedPath}:`, err?.message || err);
        return false;
    }
};

/**
 * Recursively deletes a folder and all its contents in Firebase Storage.
 * Calls deleteStoragePath Cloud Function with isFolder: true.
 */
export const deleteStorageFolder = async (folderPath: string): Promise<void> => {
    if (!folderPath) return;

    // 1. Try Cloud Function (Admin SDK on backend)
    try {
        const deleteFn = httpsCallable<{ storagePath: string; isFolder?: boolean }, { success: boolean }>(functions, 'deleteStoragePath');
        const res = await deleteFn({ storagePath: folderPath, isFolder: true });
        if (res.data?.success) {
            console.log(`[STORAGE] Deleted folder via Cloud Function: ${folderPath}`);
            return;
        }
    } catch (cfErr: any) {
        console.warn(`[STORAGE] deleteStoragePath Cloud Function error for folder ${folderPath}, trying client fallback:`, cfErr?.message || cfErr);
    }

    // 2. Client-side fallback
    try {
        const folderRef = ref(storage, folderPath);
        const res = await listAll(folderRef);
        
        const deletePromises = res.items.map(itemRef => deleteObject(itemRef));
        const subfolderPromises = res.prefixes.map(prefixRef => deleteStorageFolder(prefixRef.fullPath));
        
        await Promise.all([...deletePromises, ...subfolderPromises]);
    } catch (err: any) {
        // Ignore "object-not-found" or "unauthorized" errors if the folder was already empty/non-existent
        if (err.code !== 'storage/object-not-found' && err.code !== 'storage/unauthorized') {
            console.error(`Failed to delete storage folder ${folderPath}:`, err);
        }
    }
};

/**
 * Logical move of storage files from onboarding to permanent employee folder.
 */
export const moveStorageFiles = async (sourcePath: string, destinationPath: string): Promise<boolean> => {
    try {
        const moveFn = httpsCallable<{ sourcePath: string, destinationPath: string }, { success: boolean }>(functions, 'moveStorageFolder');
        const result = await moveFn({ sourcePath, destinationPath });
        return result.data.success;
    } catch (err) {
        console.error("Error moving storage files:", err);
        return false;
    }
};
