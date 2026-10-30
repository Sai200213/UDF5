/**
 * DRIVE SERVICE - CLOUD MIGRATED
 * All Google Drive & Sheets operations run strictly server-side via Google Cloud Functions.
 * Client-side Google Apps Script webhook calls have been completely decommissioned.
 */
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase/config';
import log from "@/src/utils/logger";

export const uploadToDrive = async (_file: File, _employeeName: string, _operationName: string, _uniqueId?: string): Promise<string> => {
    log.log("[DRIVE_SERVICE] uploadToDrive bypassed: files are stored in Google Cloud Storage and streamed to Drive via Cloud Functions.");
    return '';
};

export const moveEmployeeFolder = async (employeeName: string, _uniqueId: string, action: string, _folderName?: string): Promise<void> => {
    log.log(`[DRIVE_SERVICE] Folder move action "${action}" bypassed for: ${employeeName} (server-managed).`);
};

export const moveEmployeeFolderToRecycleBin = async (employeeName: string, uniqueId: string, folderName?: string): Promise<void> => {
    await moveEmployeeFolder(employeeName, uniqueId, 'delete_employee', folderName);
};

export const restoreEmployeeFolderFromRecycleBin = async (employeeName: string, uniqueId: string, folderName?: string): Promise<void> => {
    await moveEmployeeFolder(employeeName, uniqueId, 'restore_employee', folderName);
};

export const permanentDeleteEmployeeFolder = async (employeeName: string, _uniqueId: string, _folderName?: string): Promise<void> => {
    log.log(`[DRIVE_SERVICE] Permanent delete bypassed for: ${employeeName} (server-managed).`);
};

export const renameEmployeeFolder = async (oldName: string, newName: string): Promise<void> => {
    log.log(`[DRIVE_SERVICE] Rename bypassed: ${oldName} -> ${newName} (server-managed).`);
};

export const approveEmployeeFolder = async (oldFolderName: string, newFolderName: string): Promise<void> => {
    log.log(`[DRIVE_SERVICE] Approve folder move bypassed: ${oldFolderName} -> ${newFolderName} (server-managed).`);
};

export const createEmployeeFolder = async (employeeName: string, uniqueId: string): Promise<void> => {
    log.log(`[DRIVE_SERVICE] createEmployeeFolder bypassed for ${employeeName} (${uniqueId}) (server-managed).`);
};

export const copyFolderContents = async (_sourceFolderName: string, _targetFolderName: string): Promise<void> => {
    log.log("[DRIVE_SERVICE] copyFolderContents bypassed (server-managed).");
};

export const copySpecificSubfolders = async (_sourceFolderName: string, _targetFolderName: string, _foldersToCopy: string[]): Promise<void> => {
    log.log("[DRIVE_SERVICE] copySpecificSubfolders bypassed (server-managed).");
};

export const syncFolderInDrive = async (_employeeName: string, _employeeId: string, currentFolder?: string): Promise<string> => {
    return currentFolder || '';
};

export const submitToGoogleForm = async (_formData: any, _email?: string | null): Promise<void> => {
    log.log("[DRIVE_SERVICE] submitToGoogleForm bypassed: handled server-side via syncSubmissionToSheetsServer.");
};

export const syncEmployeeToGoogleDrive = async (recordId: string, targetType?: string) => {
    const fn = httpsCallable<{ recordId: string; targetType?: string }, { success: boolean; count: number; folderUrl?: string }>(functions, 'syncEmployeeToGoogleDriveServer');
    return await fn({ recordId, targetType });
};

export const syncSubmissionToSheets = async (submissionId: string) => {
    const fn = httpsCallable<{ submissionId: string }, { success: boolean; status?: string }>(functions, 'syncSubmissionToSheetsServer');
    return await fn({ submissionId });
};
