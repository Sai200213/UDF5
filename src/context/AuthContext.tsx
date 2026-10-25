import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { User, UserType } from '../../types';

interface AuthContextType {
    user: User | null;
    loading: boolean;
    setUser: (user: User | null) => void;
    /** Call this BEFORE signInWithCustomToken to prevent AuthContext from clearing the user during login */
    lockSession: () => void;
    /** Call this AFTER login is fully complete to release the lock */
    unlockSession: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

import { auth } from '../firebase/config';
import { onAuthStateChanged } from 'firebase/auth';
import { getEmployeeProfile, getAdminProfile, getStaffProfile } from '../services/authService';
import log from '../utils/logger';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const sessionLockRef = useRef(false);

    const lockSession = useCallback(() => {
        log.log('AuthContext: Session LOCKED — suppressing profile resolution during login flow');
        sessionLockRef.current = true;
    }, []);

    const unlockSession = useCallback(() => {
        log.log('AuthContext: Session UNLOCKED');
        sessionLockRef.current = false;
    }, []);

    useEffect(() => {
        let isSubscribed = true;

        const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
            const portalType = localStorage.getItem('portalType');

            if (portalType === 'onboarding') {
                log.log('AuthContext: Onboarding mode detected, suppressing profile restoration.');
                if (isSubscribed) {
                    setUser(null);
                    setLoading(false);
                }
                return;
            }

            // KEY FIX: If session is locked, skip profile resolution entirely.
            // App.tsx's onLoginSuccess will set the user directly.
            if (sessionLockRef.current) {
                log.log('AuthContext: Session locked, skipping profile resolution. App.tsx will handle user state.');
                if (isSubscribed) setLoading(false);
                return;
            }

            if (isSubscribed) setLoading(true);

            if (firebaseUser && !firebaseUser.isAnonymous) {
                try {
                    let resolvedUser: User | null = null;

                    if (portalType === 'employee') {
                        resolvedUser = await getEmployeeProfile(firebaseUser);
                    } else if (portalType === 'management') {
                        resolvedUser = await getAdminProfile(firebaseUser);
                        if (!resolvedUser) {
                            resolvedUser = await getStaffProfile(firebaseUser);
                        }
                    } else {
                        resolvedUser = await getAdminProfile(firebaseUser);
                        if (!resolvedUser) resolvedUser = await getStaffProfile(firebaseUser);
                        if (!resolvedUser) resolvedUser = await getEmployeeProfile(firebaseUser);
                    }

                    if (isSubscribed) {
                        if (resolvedUser) {
                            log.log(`AuthContext: Restored session for ${resolvedUser.name} (${resolvedUser.type})`);
                            setUser(resolvedUser);
                        } else {
                            log.log('AuthContext: Authenticated but no profile found in collections. Resolving as Public User.');
                            setUser({
                                type: UserType.PUBLIC,
                                id: firebaseUser.uid,
                                name: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'Guest User',
                                roleId: 'guest'
                            });
                        }
                    }
                } catch (error) {
                    log.error('AuthContext: Profile restoration error', error);
                    if (isSubscribed) setUser(null);
                }
            } else {
                if (isSubscribed) setUser(null);
            }

            if (isSubscribed) setLoading(false);
        });

        return () => {
            isSubscribed = false;
            unsubscribe();
        };
    }, []);

    // CLOUD-3: Real-time custom claims & permissions sync listener for Admin/Staff
    useEffect(() => {
        if (!user || user.type !== UserType.ADMIN || !user.id) return;

        let unsubStaff: (() => void) | null = null;
        const listenForClaimUpdates = async () => {
            try {
                const { db } = await import('../firebase/config');
                const { doc, onSnapshot } = await import('firebase/firestore');

                const staffRef = doc(db, 'staff_accounts', user.id);
                unsubStaff = onSnapshot(staffRef, async (snap) => {
                    if (snap.exists()) {
                        const data = snap.data();
                        // If claims were updated on server, refresh JWT token immediately
                        if (data.claimsUpdatedAt) {
                            try {
                                log.log('AuthContext: Detected claimsUpdatedAt update, refreshing Firebase Auth JWT token...');
                                await auth.currentUser?.getIdToken(true);
                            } catch (tokenErr) {
                                log.warn('AuthContext: Could not refresh token on claims change:', tokenErr);
                            }
                        }
                        // Update local user state if role, permissions, or sites changed
                        if (data.roleId !== user.roleId || JSON.stringify(data.sitesManaged) !== JSON.stringify(user.sitesManaged)) {
                            setUser(prev => prev ? ({
                                ...prev,
                                roleId: data.roleId || prev.roleId,
                                sitesManaged: data.sitesManaged || prev.sitesManaged,
                                permissionOverrides: data.permissionOverrides || prev.permissionOverrides
                            }) : null);
                        }
                    }
                }, (err) => {
                    log.warn('AuthContext: staff_accounts claim listener warning:', err);
                });
            } catch (setupErr) {
                log.warn('AuthContext: Could not attach staff claim listener:', setupErr);
            }
        };

        listenForClaimUpdates();
        return () => {
            if (unsubStaff) unsubStaff();
        };
    }, [user?.id, user?.type]);

    return (
        <AuthContext.Provider value={{ user, loading, setUser, lockSession, unlockSession }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};
