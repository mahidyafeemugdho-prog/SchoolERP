import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  initializeAuth,
  inMemoryPersistence,
  browserSessionPersistence,
  setPersistence,
  browserPopupRedirectResolver,
  GoogleAuthProvider,
  EmailAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  updatePassword,
  signOut,
  User,
} from 'firebase/auth';
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const currentUser = auth?.currentUser;
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: currentUser?.uid,
      email: currentUser?.email,
      emailVerified: currentUser?.emailVerified,
      isAnonymous: currentUser?.isAnonymous,
      tenantId: currentUser?.tenantId,
      providerInfo:
        currentUser?.providerData?.map((provider: any) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.warn('Firestore Error: ', JSON.stringify(errInfo));
  return errInfo;
}

const GOOGLE_REDIRECT_PENDING_KEY = 'smartschool_google_redirect_pending';

export function isEmbeddedIframe(): boolean {
  try {
    return typeof window !== 'undefined' && window.self !== window.top;
  } catch {
    return true;
  }
}

export function isMobileBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(
    navigator.userAgent
  );
}

export function markGoogleRedirectPending(pending: boolean): void {
  try {
    if (pending) {
      sessionStorage.setItem(GOOGLE_REDIRECT_PENDING_KEY, '1');
    } else {
      sessionStorage.removeItem(GOOGLE_REDIRECT_PENDING_KEY);
    }
  } catch {
    // Ignore storage failures in restricted third-party iframes
  }
}

export function isGoogleRedirectPending(): boolean {
  try {
    return sessionStorage.getItem(GOOGLE_REDIRECT_PENDING_KEY) === '1';
  } catch {
    return false;
  }
}

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
// Use browserSessionPersistence so redirect OAuth works within the active tab while still isolating fresh browser tabs
export const auth = (() => {
  try {
    return initializeAuth(app, {
      persistence: [browserSessionPersistence, inMemoryPersistence],
      popupRedirectResolver: browserPopupRedirectResolver,
    });
  } catch {
    const existingAuth = getAuth(app);
    setPersistence(existingAuth, browserSessionPersistence).catch(() => {
      setPersistence(existingAuth, inMemoryPersistence).catch(() => {});
    });
    return existingAuth;
  }
})();
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });
// CRITICAL: Must pass firestoreDatabaseId as required by skill guidelines
export const db = getFirestore(app, (firebaseConfig as any).firestoreDatabaseId);

export async function testConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('Firebase client is offline or starting up.');
      return false;
    }
    return true;
  }
}

export async function loginWithFirebaseEmail(email: string, password: string) {
  return await signInWithEmailAndPassword(auth, email.trim(), password);
}

export async function loginWithGoogle() {
  try {
    return await signInWithPopup(auth, googleProvider);
  } catch (err) {
    console.error('Google Sign In Error:', err);
    throw err;
  }
}

export async function loginWithGoogleRedirect() {
  markGoogleRedirectPending(true);
  await signInWithRedirect(auth, googleProvider);
}

export async function completeGoogleRedirectLogin() {
  try {
    return await getRedirectResult(auth);
  } catch (err) {
    console.error('Google Redirect Result Error:', err);
    throw err;
  }
}

export async function getFreshIdToken(forceRefresh = false): Promise<string | null> {
  const user = auth.currentUser;
  if (!user) return null;
  return await user.getIdToken(forceRefresh);
}

export async function resetFirebasePassword(email: string) {
  return await sendPasswordResetEmail(auth, email.trim());
}

export function hasPasswordProvider(user: User | null): boolean {
  return Boolean(user?.providerData?.some((p) => p.providerId === 'password'));
}

export async function reauthenticateWithCurrentPassword(currentPassword: string): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.email) {
    throw new Error('No authenticated email session found.');
  }
  const cred = EmailAuthProvider.credential(user.email, currentPassword);
  await reauthenticateWithCredential(user, cred);
}

export async function reauthenticateWithGoogleAccount(): Promise<void> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('No authenticated user session found.');
  }
  await reauthenticateWithPopup(user, googleProvider);
}

export async function updateFirebaseClientPassword(newPassword: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('No authenticated user session found.');
  }
  await updatePassword(user, newPassword);
}

export async function logoutUser() {
  return await signOut(auth);
}
