import React, { createContext, useContext, useEffect, useState } from 'react';
import { 
  onAuthStateChanged, 
  signInAnonymously, 
  signOut as fbSignOut,
  updateProfile,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword
} from 'firebase/auth';
import { auth } from '../lib/firebase';

export interface AppUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  isAnonymous: boolean;
}

interface AuthContextType {
  user: AppUser | null;
  loading: boolean;
  userName: string;
  userColor: string;
  userAvatar: string;
  signUp: (email: string, pass: string, name: string) => Promise<void>;
  logIn: (email: string, pass: string) => Promise<void>;
  logInAsGuest: (name: string) => Promise<void>;
  logOut: () => Promise<void>;
  authWarning: string | null;
}

const COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#10b981', '#06b6d4', 
  '#3b82f6', '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e'
];

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [fbUser, setFbUser] = useState<AppUser | null>(null);
  const [localUser, setLocalUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [userName, setUserName] = useState('');
  const [userColor, setUserColor] = useState('#3b82f6');
  const [userAvatar, setUserAvatar] = useState('');
  const [authWarning, setAuthWarning] = useState<string | null>(null);

  const activeUser = fbUser || localUser;

  useEffect(() => {
    // 1. Recover saved local user if exists
    const savedLocalUserStr = localStorage.getItem('canvas_sync_local_user');
    let initialLocalUser: AppUser | null = null;
    if (savedLocalUserStr) {
      try {
        initialLocalUser = JSON.parse(savedLocalUserStr);
        setLocalUser(initialLocalUser);
        if (initialLocalUser) {
          setUserName(initialLocalUser.displayName || 'Local User');
          
          let storedColor = localStorage.getItem(`color_${initialLocalUser.uid}`);
          if (!storedColor) {
            storedColor = COLORS[Math.floor(Math.random() * COLORS.length)];
            localStorage.setItem(`color_${initialLocalUser.uid}`, storedColor);
          }
          setUserColor(storedColor);

          const initials = (initialLocalUser.displayName || 'LU')
            .split(' ')
            .map(n => n[0])
            .join('')
            .toUpperCase()
            .slice(0, 2);
          setUserAvatar(initials);
          setAuthWarning("Using local collaboration session (Firebase Auth is restricted).");
        }
      } catch (e) {
        console.error("Failed to parse saved local user:", e);
      }
    }

    // 2. Listen to Firebase auth changes
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (currentUser) {
        const mappedUser: AppUser = {
          uid: currentUser.uid,
          email: currentUser.email,
          displayName: currentUser.displayName,
          isAnonymous: currentUser.isAnonymous,
        };
        setFbUser(mappedUser);
        setUserName(currentUser.displayName || 'Anonymous User');
        setAuthWarning(null); // Clear warning since real firebase user is authenticated
        
        let storedColor = localStorage.getItem(`color_${currentUser.uid}`);
        if (!storedColor) {
          storedColor = COLORS[Math.floor(Math.random() * COLORS.length)];
          localStorage.setItem(`color_${currentUser.uid}`, storedColor);
        }
        setUserColor(storedColor);

        const initials = (currentUser.displayName || 'AU')
          .split(' ')
          .map(n => n[0])
          .join('')
          .toUpperCase()
          .slice(0, 2);
        setUserAvatar(initials);
      } else {
        setFbUser(null);
        if (!initialLocalUser) {
          setUserName('');
          setUserAvatar('');
        }
      }
      setLoading(false);
    }, (error) => {
      console.error("Auth state change error:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const signUp = async (email: string, pass: string, name: string) => {
    setLoading(true);
    setAuthWarning(null);
    try {
      const res = await createUserWithEmailAndPassword(auth, email, pass);
      await updateProfile(res.user, { displayName: name });
      const mappedUser: AppUser = {
        uid: res.user.uid,
        email: res.user.email,
        displayName: name,
        isAnonymous: false
      };
      setFbUser(mappedUser);
      setUserName(name);
    } catch (err: any) {
      console.warn("Firebase Auth signup failed, creating a Local Account:", err);
      
      const localUsersStr = localStorage.getItem('canvas_sync_local_db_users') || '[]';
      const localUsers = JSON.parse(localUsersStr);
      
      if (localUsers.some((u: any) => u.email === email)) {
        throw new Error("Local account with this email already exists!");
      }
      
      const localUid = 'local_' + Math.random().toString(36).substring(2, 15);
      const newLocalUser = {
        uid: localUid,
        email,
        password: pass,
        displayName: name,
        isAnonymous: false,
      };
      
      localUsers.push(newLocalUser);
      localStorage.setItem('canvas_sync_local_db_users', JSON.stringify(localUsers));
      
      const appUser: AppUser = {
        uid: localUid,
        email,
        displayName: name,
        isAnonymous: false,
      };
      
      localStorage.setItem('canvas_sync_local_user', JSON.stringify(appUser));
      setLocalUser(appUser);
      setUserName(name);
      setAuthWarning("Connected to local database session (Firebase signup restricted).");

      let storedColor = localStorage.getItem(`color_${localUid}`);
      if (!storedColor) {
        storedColor = COLORS[Math.floor(Math.random() * COLORS.length)];
        localStorage.setItem(`color_${localUid}`, storedColor);
      }
      setUserColor(storedColor);

      const initials = name
        .split(' ')
        .map(n => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
      setUserAvatar(initials || 'U');
    } finally {
      setLoading(false);
    }
  };

  const logIn = async (email: string, pass: string) => {
    setLoading(true);
    setAuthWarning(null);
    try {
      const res = await signInWithEmailAndPassword(auth, email, pass);
      const mappedUser: AppUser = {
        uid: res.user.uid,
        email: res.user.email,
        displayName: res.user.displayName,
        isAnonymous: false
      };
      setFbUser(mappedUser);
      setUserName(res.user.displayName || 'User');
    } catch (err: any) {
      console.warn("Firebase Auth login failed, looking for Local Account:", err);
      
      const localUsersStr = localStorage.getItem('canvas_sync_local_db_users') || '[]';
      const localUsers = JSON.parse(localUsersStr);
      
      const matchedUser = localUsers.find((u: any) => u.email === email && u.password === pass);
      if (!matchedUser) {
        // If it's a restricted operation error, let the user know they can join as guest, or throw the error
        if (err.code === 'auth/admin-restricted-operation' || err.message?.includes('admin-restricted-operation')) {
          throw new Error("This Firebase operation is restricted by administrative settings. Please join using 'Join as Guest' for sandbox collaboration!");
        }
        throw err;
      }
      
      const appUser: AppUser = {
        uid: matchedUser.uid,
        email: matchedUser.email,
        displayName: matchedUser.displayName,
        isAnonymous: false,
      };
      
      localStorage.setItem('canvas_sync_local_user', JSON.stringify(appUser));
      setLocalUser(appUser);
      setUserName(matchedUser.displayName || 'User');
      setAuthWarning("Loaded local database session (Firebase login restricted).");

      let storedColor = localStorage.getItem(`color_${matchedUser.uid}`);
      if (!storedColor) {
        storedColor = COLORS[Math.floor(Math.random() * COLORS.length)];
        localStorage.setItem(`color_${matchedUser.uid}`, storedColor);
      }
      setUserColor(storedColor);

      const initials = (matchedUser.displayName || 'User')
        .split(' ')
        .map((n: string) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
      setUserAvatar(initials || 'U');
    } finally {
      setLoading(false);
    }
  };

  const logInAsGuest = async (name: string) => {
    setLoading(true);
    setAuthWarning(null);
    try {
      const res = await signInAnonymously(auth);
      await updateProfile(res.user, { displayName: name });
      const mappedUser: AppUser = {
        uid: res.user.uid,
        email: null,
        displayName: name,
        isAnonymous: true
      };
      setFbUser(mappedUser);
      setUserName(name);
    } catch (err: any) {
      console.warn("Firebase Auth guest login failed, falling back to Local Sandbox Session:", err);
      
      let localUid = localStorage.getItem('canvas_sync_local_uid');
      if (!localUid) {
        localUid = 'local_' + Math.random().toString(36).substring(2, 15);
        localStorage.setItem('canvas_sync_local_uid', localUid);
      }
      
      const guestUser: AppUser = {
        uid: localUid,
        email: null,
        displayName: name,
        isAnonymous: true,
      };
      
      localStorage.setItem('canvas_sync_local_user', JSON.stringify(guestUser));
      setLocalUser(guestUser);
      setUserName(name);
      setAuthWarning("Using local collaboration session (Firebase anonymous auth is restricted).");
      
      let storedColor = localStorage.getItem(`color_${localUid}`);
      if (!storedColor) {
        storedColor = COLORS[Math.floor(Math.random() * COLORS.length)];
        localStorage.setItem(`color_${localUid}`, storedColor);
      }
      setUserColor(storedColor);

      const initials = name
        .split(' ')
        .map(n => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
      setUserAvatar(initials || 'G');
    } finally {
      setLoading(false);
    }
  };

  const logOut = async () => {
    setLoading(true);
    try {
      await fbSignOut(auth);
    } catch (err) {
      console.warn("Firebase signout failed, clearing local session:", err);
    } finally {
      localStorage.removeItem('canvas_sync_local_user');
      setLocalUser(null);
      setFbUser(null);
      setUserName('');
      setUserAvatar('');
      setAuthWarning(null);
      setLoading(false);
    }
  };

  return (
    <AuthContext.Provider value={{
      user: activeUser,
      loading,
      userName,
      userColor,
      userAvatar,
      signUp,
      logIn,
      logInAsGuest,
      logOut,
      authWarning
    }}>
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
