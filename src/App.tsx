/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import { AuthScreen } from './components/AuthScreen';
import { Dashboard } from './components/Dashboard';
import { Whiteboard } from './components/Whiteboard';

function MainAppContent() {
  const { user, loading } = useAuth();
  const { isDark } = useTheme();
  const [activeBoardId, setActiveBoardId] = useState<string | null>(null);

  // Sync state with URL parameter for seamless deep linking / invitations!
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const boardFromUrl = params.get('board');
    
    const pathname = window.location.pathname;
    let boardIdFromPath: string | null = null;
    if (pathname.startsWith('/board/')) {
      boardIdFromPath = pathname.substring(7);
    }

    const initialBoardId = boardIdFromPath || boardFromUrl;
    if (initialBoardId) {
      setActiveBoardId(initialBoardId);
    }

    // Support back/forward browser navigation
    const handlePopState = () => {
      const updatedParams = new URLSearchParams(window.location.search);
      const updatedPathname = window.location.pathname;
      let updatedBoardIdFromPath: string | null = null;
      if (updatedPathname.startsWith('/board/')) {
        updatedBoardIdFromPath = updatedPathname.substring(7);
      }
      setActiveBoardId(updatedBoardIdFromPath || updatedParams.get('board'));
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const handleSelectBoard = (boardId: string) => {
    setActiveBoardId(boardId);
    // Dynamic URL push state so copying URL works instantly!
    const newUrl = `${window.location.origin}/board/${boardId}`;
    window.history.pushState({ boardId }, '', newUrl);
  };

  const handleBackToDashboard = () => {
    setActiveBoardId(null);
    window.history.pushState({}, '', window.location.origin);
  };

  if (loading) {
    return (
      <div className={`min-h-screen flex flex-col items-center justify-center gap-4 font-sans transition-colors duration-300 ${isDark ? 'bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-800'}`}>
        <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin shadow-md"></div>
        <p className={`${isDark ? 'text-slate-400' : 'text-slate-500'} font-bold text-sm tracking-wide`}>Syncing Workspace Session...</p>
      </div>
    );
  }

  // Guard: Not Authenticated
  if (!user) {
    return <AuthScreen />;
  }

  // Guard: Whiteboard screen deep link or selected
  if (activeBoardId) {
    return (
      <Whiteboard 
        boardId={activeBoardId} 
        onBackToDashboard={handleBackToDashboard} 
      />
    );
  }

  // Default: Dashboard screen
  return <Dashboard onSelectBoard={handleSelectBoard} />;
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <MainAppContent />
      </AuthProvider>
    </ThemeProvider>
  );
}

