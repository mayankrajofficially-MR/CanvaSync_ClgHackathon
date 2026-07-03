import React, { useState, useEffect } from 'react';
import { 
  Plus, 
  Search, 
  Grid, 
  List as ListIcon, 
  Trash2, 
  Folder, 
  Settings, 
  HelpCircle, 
  LogOut, 
  Users, 
  Clock, 
  Star, 
  MoreVertical, 
  Copy, 
  Check, 
  Share2, 
  Layers, 
  X,
  Lock,
  Globe,
  RefreshCw,
  FolderOpen,
  Calendar,
  Sparkles,
  ArrowRight,
  Tag,
  Sun,
  Moon
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { db } from '../lib/firebase';
import { 
  collection, 
  addDoc, 
  getDocs, 
  query, 
  where, 
  deleteDoc, 
  doc, 
  updateDoc, 
  orderBy,
  serverTimestamp,
  setDoc
} from 'firebase/firestore';
import { Board } from '../types';
import { searchBoards } from '../lib/fuzzySearch';
import { motion, AnimatePresence } from 'motion/react';

interface DashboardProps {
  onSelectBoard: (boardId: string) => void;
}

// Premium visual covers matching a top-tier SaaS
const COVER_IMAGES = [
  'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=600&q=80', // beautiful organic flow abstract
  'https://images.unsplash.com/photo-1579546929518-9e396f3cc809?auto=format&fit=crop&w=600&q=80', // vibrant gradient
  'https://images.unsplash.com/photo-1614064641938-3bbee52942c7?auto=format&fit=crop&w=600&q=80', // tech line art
  'https://images.unsplash.com/photo-1634017839464-5c339ebe3cb4?auto=format&fit=crop&w=600&q=80', // 3d geometry
  'https://images.unsplash.com/photo-1618005198143-d3667531c19b?auto=format&fit=crop&w=600&q=80'  // clean flow diagram look
];

export const Dashboard: React.FC<DashboardProps> = ({ onSelectBoard }) => {
  const { user, userName, userAvatar, userColor, logOut, authWarning } = useAuth();
  const { theme, isDark, toggleTheme } = useTheme();
  const [activeTab, setActiveTab] = useState<'boards' | 'shared' | 'templates' | 'trash'>('boards');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [boards, setBoards] = useState<Board[]>([]);
  const [loadingBoards, setLoadingBoards] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newBoardTitle, setNewBoardTitle] = useState('');
  const [newBoardTags, setNewBoardTags] = useState('');
  const [newBoardPermission, setNewBoardPermission] = useState<'owner' | 'editor' | 'viewer'>('editor');
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Editing board states
  const [editingBoard, setEditingBoard] = useState<Board | null>(null);
  const [editBoardTitle, setEditBoardTitle] = useState('');
  const [editBoardTags, setEditBoardTags] = useState('');
  const [isUpdatingBoard, setIsUpdatingBoard] = useState(false);
  
  // Quick share link states
  const [copiedBoardId, setCopiedBoardId] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<string[]>(() => {
    const saved = localStorage.getItem('favorites');
    return saved ? JSON.parse(saved) : [];
  });

  const [recentVisited, setRecentVisited] = useState<string[]>(() => {
    const saved = localStorage.getItem('recent_visited');
    return saved ? JSON.parse(saved) : [];
  });

  // Filtered boards for searching and trash
  const [deletedBoards, setDeletedBoards] = useState<Board[]>([]);

  // Fetch boards from Firestore
  const fetchBoards = async () => {
    if (!user) return;
    setLoadingBoards(true);
    try {
      // 1. Fetch user's own boards
      const qOwn = query(
        collection(db, 'boards'),
        where('ownerId', '==', user.uid)
      );
      const snapshotOwn = await getDocs(qOwn);
      const ownBoards = snapshotOwn.docs.map(d => ({ id: d.id, ...d.data() } as Board));
      
      // 2. Fetch boards where user is a collaborator
      let collaboratorBoards: Board[] = [];
      if (user.email) {
        const qCollab = query(
          collection(db, 'boards'),
          where('collaborators', 'array-contains', user.email.toLowerCase())
        );
        try {
          const snapshotCollab = await getDocs(qCollab);
          collaboratorBoards = snapshotCollab.docs.map(d => ({ id: d.id, ...d.data() } as Board));
        } catch (collabErr) {
          console.warn("Failed to fetch collaborator boards or query requires index", collabErr);
        }
      }

      // Merge and remove duplicates
      const allBoardsMap = new Map<string, Board>();
      ownBoards.forEach(b => allBoardsMap.set(b.id, b));
      collaboratorBoards.forEach(b => allBoardsMap.set(b.id, b));
      const mergedBoards = Array.from(allBoardsMap.values());

      // Sort client-side by createdAt descending
      mergedBoards.sort((a, b) => b.createdAt - a.createdAt);

      // Separate active and soft-deleted boards
      const trashIds = JSON.parse(localStorage.getItem('trash_boards') || '[]');
      const activeOwn = mergedBoards.filter(b => !trashIds.includes(b.id));
      const deletedOwn = mergedBoards.filter(b => trashIds.includes(b.id));

      setBoards(activeOwn);
      setDeletedBoards(deletedOwn);
    } catch (e) {
      console.error("Error fetching boards: ", e);
    } finally {
      setLoadingBoards(false);
    }
  };

  useEffect(() => {
    fetchBoards();
  }, [user]);

  useEffect(() => {
    if (showCreateModal) {
      setCreateError(null);
    }
  }, [showCreateModal]);

  const toggleFavorite = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = favorites.includes(id) 
      ? favorites.filter(favId => favId !== id) 
      : [...favorites, id];
    setFavorites(updated);
    localStorage.setItem('favorites', JSON.stringify(updated));
  };

  const createBoard = async (templateName?: string) => {
    if (!user) return;
    
    let title = newBoardTitle.trim() || 'Untitled Board';
    if (templateName) {
      title = `${templateName} Template`;
    }

    let tags: string[] = [];
    if (templateName) {
      if (templateName === 'Mind Map') {
        tags = ['mindmap', 'brainstorming', 'creative', 'template'];
      } else if (templateName === 'Sprint Planning') {
        tags = ['sprint', 'scrum', 'agile', 'template'];
      } else if (templateName === 'System Design') {
        tags = ['architecture', 'design', 'system', 'template'];
      } else {
        tags = ['template'];
      }
    } else {
      tags = newBoardTags
        ? newBoardTags
            .split(',')
            .map(t => t.trim().toLowerCase())
            .filter(t => t.length > 0)
        : [];
    }

    setIsCreating(true);
    setCreateError(null);
    try {
      const boardsRef = collection(db, 'boards');
      const docRef = doc(boardsRef); // Synchronously generate ID!
      const boardId = docRef.id;

      const newBoardData = {
        title,
        ownerId: user.uid,
        ownerName: userName || user.email || 'Anonymous',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        collaborators: [],
        permissions: {
          [user.uid]: 'owner'
        },
        isPrivate: newBoardPermission === 'owner',
        pagesCount: 1,
        currentPage: 0,
        tags
      };

      // To prevent unresolved promises from blocking the user navigation,
      // we attempt to save to Firestore with an 800ms timeout.
      // Firestore has local latency compensation: if the save is slightly delayed,
      // the local write is cached instantly and our app can transition immediately.
      try {
        await Promise.race([
          setDoc(docRef, newBoardData),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 800))
        ]);
      } catch (writeErr: any) {
        if (writeErr.message === 'timeout') {
          console.warn("Firestore write is taking longer than expected. Proceeding with latency-compensated local state.");
        } else {
          // A genuine Firestore error (e.g., permissions, bad request)
          throw writeErr;
        }
      }
      
      // If template, seed some elements (we can run this with a timeout or let it complete)
      if (templateName) {
        try {
          await Promise.race([
            seedTemplateElements(boardId, templateName),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 800))
          ]);
        } catch (seedErr) {
          console.warn("Seeding elements has timed out or failed. Elements will sync in background.", seedErr);
        }
      }

      // Reset modal and inputs
      setShowCreateModal(false);
      setNewBoardTitle('');
      setNewBoardTags('');
      setIsCreating(false);
      
      // Immediately navigate to the newly created board!
      onSelectBoard(boardId);
    } catch (e: any) {
      console.error("Error creating board", e);
      setCreateError(e?.message || "Failed to create sketchboard. Please try again.");
      setIsCreating(false);
    }
  };

  const seedTemplateElements = async (boardId: string, template: string) => {
    const elRef = collection(db, 'boards', boardId, 'elements');
    const base = {
      color: '#0050cb',
      strokeWidth: 4,
      opacity: 1,
      createdAt: Date.now(),
      updatedBy: user?.uid || 'system',
      userName: userName || 'System',
      page: 0
    };

    if (template === 'Sprint Planning') {
      // 3 Sticky Columns
      const headers = ['To Do', 'In Progress', 'Done'];
      const colors = ['#fef08a', '#bfdbfe', '#bbf7d0'];
      for (let i = 0; i < headers.length; i++) {
        await addDoc(elRef, {
          ...base,
          type: 'sticky',
          x: 100 + i * 350,
          y: 100,
          width: 300,
          height: 350,
          text: `## ${headers[i]}\n\nAdd task cards here!\nDouble-click to edit.`,
          bgColor: colors[i]
        });
      }
    } else if (template === 'System Design') {
      // Draw client box
      await addDoc(elRef, {
        ...base,
        type: 'rectangle',
        x: 150,
        y: 200,
        width: 150,
        height: 100,
        fillColor: 'transparent',
        color: '#3b82f6'
      });
      await addDoc(elRef, {
        ...base,
        type: 'text',
        x: 175,
        y: 240,
        text: 'Client App',
        fontSize: 18,
        fontFamily: 'sans'
      });

      // Draw API gateway
      await addDoc(elRef, {
        ...base,
        type: 'rectangle',
        x: 450,
        y: 150,
        width: 160,
        height: 200,
        fillColor: 'transparent',
        color: '#10b981'
      });
      await addDoc(elRef, {
        ...base,
        type: 'text',
        x: 470,
        y: 240,
        text: 'API Gateway',
        fontSize: 18,
        fontFamily: 'sans'
      });

      // Draw DB cylinder
      await addDoc(elRef, {
        ...base,
        type: 'circle',
        cx: 800,
        cy: 250,
        rx: 60,
        ry: 60,
        fillColor: 'transparent',
        color: '#ef4444'
      });
      await addDoc(elRef, {
        ...base,
        type: 'text',
        x: 760,
        y: 240,
        text: 'Firestore',
        fontSize: 18,
        fontFamily: 'sans'
      });

      // Arrow lines
      await addDoc(elRef, {
        ...base,
        type: 'line',
        x1: 300,
        y1: 250,
        x2: 450,
        y2: 250
      });
      await addDoc(elRef, {
        ...base,
        type: 'line',
        x1: 610,
        y1: 250,
        x2: 740,
        y2: 250
      });
    } else if (template === 'Mind Map') {
      // Core idea
      await addDoc(elRef, {
        ...base,
        type: 'circle',
        cx: 500,
        cy: 300,
        rx: 100,
        ry: 60,
        fillColor: 'transparent',
        color: '#8b5cf6'
      });
      await addDoc(elRef, {
        ...base,
        type: 'text',
        x: 450,
        y: 290,
        text: 'Main Idea',
        fontSize: 22,
        fontFamily: 'sans'
      });

      // Branch 1
      await addDoc(elRef, {
        ...base,
        type: 'line',
        x1: 400,
        y1: 300,
        x2: 250,
        y2: 200
      });
      await addDoc(elRef, {
        ...base,
        type: 'sticky',
        x: 100,
        y: 120,
        width: 150,
        height: 150,
        text: 'Subtopic 1\n\nResearch plans',
        bgColor: '#fecdd3'
      });

      // Branch 2
      await addDoc(elRef, {
        ...base,
        type: 'line',
        x1: 600,
        y1: 300,
        x2: 750,
        y2: 400
      });
      await addDoc(elRef, {
        ...base,
        type: 'sticky',
        x: 750,
        y: 350,
        width: 150,
        height: 150,
        text: 'Subtopic 2\n\nDesign sketches',
        bgColor: '#fef08a'
      });
    }
  };

  const softDeleteBoard = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const target = boards.find(b => b.id === id) || deletedBoards.find(b => b.id === id);
    if (target && target.ownerId !== user?.uid) return;

    const trash = JSON.parse(localStorage.getItem('trash_boards') || '[]');
    if (!trash.includes(id)) {
      trash.push(id);
      localStorage.setItem('trash_boards', JSON.stringify(trash));
    }
    fetchBoards();
  };

  const restoreBoard = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const target = boards.find(b => b.id === id) || deletedBoards.find(b => b.id === id);
    if (target && target.ownerId !== user?.uid) return;

    let trash = JSON.parse(localStorage.getItem('trash_boards') || '[]');
    trash = trash.filter((tid: string) => tid !== id);
    localStorage.setItem('trash_boards', JSON.stringify(trash));
    fetchBoards();
  };

  const permanentlyDeleteBoard = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const target = boards.find(b => b.id === id) || deletedBoards.find(b => b.id === id);
    if (target && target.ownerId !== user?.uid) return;

    if (!confirm("Are you sure you want to permanently delete this board? This action is irreversible.")) {
      return;
    }
    try {
      await deleteDoc(doc(db, 'boards', id));
      
      let trash = JSON.parse(localStorage.getItem('trash_boards') || '[]');
      trash = trash.filter((tid: string) => tid !== id);
      localStorage.setItem('trash_boards', JSON.stringify(trash));
      
      fetchBoards();
    } catch (err) {
      console.error(err);
    }
  };

  const updateBoardDetails = async () => {
    if (!editingBoard || !user) return;
    setIsUpdatingBoard(true);
    try {
      const parsedTags = editBoardTags
        ? editBoardTags
            .split(',')
            .map(t => t.trim().toLowerCase())
            .filter(t => t.length > 0)
        : [];

      const boardRef = doc(db, 'boards', editingBoard.id);
      await updateDoc(boardRef, {
        title: editBoardTitle.trim() || 'Untitled Board',
        tags: parsedTags,
        updatedAt: Date.now()
      });

      // Update local state
      setBoards(prev =>
        prev.map(b =>
          b.id === editingBoard.id
            ? { ...b, title: editBoardTitle.trim() || 'Untitled Board', tags: parsedTags, updatedAt: Date.now() }
            : b
        )
      );
      setEditingBoard(null);
    } catch (e) {
      console.error("Error updating board details: ", e);
    } finally {
      setIsUpdatingBoard(false);
    }
  };

  const copyShareLink = (boardId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const shareUrl = `${window.location.origin}/?board=${boardId}`;
    navigator.clipboard.writeText(shareUrl);
    setCopiedBoardId(boardId);
    setTimeout(() => setCopiedBoardId(null), 2000);
  };

  const getFilteredBoards = () => {
    let list: Board[] = [];
    if (activeTab === 'boards') {
      list = boards;
    } else if (activeTab === 'shared') {
      list = boards.filter(b => b.ownerId !== user?.uid);
    } else if (activeTab === 'trash') {
      list = deletedBoards;
    }

    if (searchQuery.trim()) {
      return searchBoards(list, searchQuery);
    }

    return list;
  };

  const filteredList = getFilteredBoards();

  // Metrics details
  const totalOwnBoards = boards.length;
  const starredBoardsCount = boards.filter(b => favorites.includes(b.id)).length;

  return (
    <div className={`flex-1 min-h-screen flex font-sans selection:bg-indigo-500/30 selection:text-indigo-200 transition-colors duration-300 ${
      isDark ? 'bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-800'
    }`}>
      
      {/* Dynamic Ambient Blur Accents */}
      <div className="absolute top-10 left-1/3 w-[450px] h-[450px] bg-indigo-600/5 rounded-full blur-[140px] pointer-events-none"></div>
      <div className="absolute bottom-10 right-1/4 w-[400px] h-[400px] bg-cyan-600/5 rounded-full blur-[120px] pointer-events-none"></div>

      {/* SideNavBar - Premium SaaS Sidebar */}
      <aside className={`w-68 backdrop-blur-2xl border-r flex flex-col p-5 shrink-0 z-10 transition-colors duration-300 ${
        isDark ? 'bg-slate-900/40 border-slate-900/80' : 'bg-white border-slate-200/80'
      }`}>
        
        {/* Workspace Brand Title */}
        <div className="mb-8 px-2 py-1 flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-tr from-indigo-600 via-purple-600 to-cyan-500 rounded-xl flex items-center justify-center text-white shadow-xl shadow-indigo-950/20">
            <Layers className="w-5.5 h-5.5" />
          </div>
          <div>
            <h1 className={`font-display font-extrabold text-xl tracking-tight leading-none ${isDark ? 'text-white' : 'text-slate-900'}`}>CanvasSync</h1>
            <p className="text-[9px] text-slate-500 font-bold tracking-widest uppercase mt-1">PRODUCTIVITY HUB</p>
          </div>
        </div>

        {/* User Account Capsule */}
        <div className={`flex items-center gap-3 p-3.5 mb-6 rounded-2xl border shadow-lg transition-colors duration-300 ${
          isDark ? 'bg-slate-950/60 border-slate-900/60 shadow-black/20' : 'bg-slate-100/90 border-slate-200/80 shadow-slate-200/50'
        }`}>
          <div 
            className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-white shadow-inner"
            style={{ backgroundColor: userColor || '#3b82f6', textShadow: '0 1px 2px rgba(0,0,0,0.2)' }}
          >
            {userAvatar || 'AU'}
          </div>
          <div className="flex flex-col min-w-0 flex-1">
            <span className={`font-bold text-sm truncate leading-snug ${isDark ? 'text-white' : 'text-slate-800'}`}>{userName || 'Guest User'}</span>
            <span className="text-[10px] text-slate-500 truncate font-mono mt-0.5">{user?.email || 'External Sandbox'}</span>
          </div>
        </div>

        {/* Navigation Menu */}
        <nav className="flex-1 space-y-1.5">
          {[
            { id: 'boards', label: 'My Boards', icon: FolderOpen },
            { id: 'shared', label: 'Shared with Me', icon: Users },
            { id: 'templates', label: 'Templates', icon: Layers },
            { id: 'trash', label: 'Trash Bin', icon: Trash2 },
          ].map((tab) => {
            const Icon = tab.icon;
            const isSelected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium text-sm transition-all duration-200 cursor-pointer relative ${
                  isSelected 
                    ? (isDark ? 'text-white' : 'text-indigo-600 font-bold') 
                    : (isDark ? 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/40' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-200/50')
                }`}
              >
                {isSelected && (
                  <motion.div 
                    layoutId="activeNavIndicator"
                    className={`absolute inset-0 border-l-2 border-indigo-500 rounded-xl ${
                      isDark ? 'bg-gradient-to-r from-indigo-600/25 to-purple-600/10' : 'bg-indigo-50/70'
                    }`}
                    transition={{ type: "spring", stiffness: 380, damping: 30 }}
                  />
                )}
                <Icon className={`w-4.5 h-4.5 shrink-0 transition-colors z-10 ${isSelected ? 'text-indigo-400' : 'text-slate-500'}`} />
                <span className="z-10">{tab.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Workspace Footer Info / Actions */}
        <div className={`pt-4 border-t space-y-3.5 ${isDark ? 'border-slate-900' : 'border-slate-200'}`}>
          <div className={`flex items-center justify-between px-3.5 py-2 rounded-xl text-[10px] font-mono ${
            isDark ? 'bg-slate-950/40 border border-slate-900/40 text-slate-500' : 'bg-slate-100 border border-slate-200 text-slate-600'
          }`}>
            <span className="font-semibold text-slate-500">v2.0 • Sandbox</span>
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
              <span className="text-emerald-500">Live Sync</span>
            </div>
          </div>
          <button 
            onClick={logOut}
            className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all cursor-pointer border border-transparent ${
              isDark ? 'text-slate-400 hover:text-red-400 hover:bg-red-950/20 hover:border-red-900/20' : 'text-slate-600 hover:text-red-500 hover:bg-red-50 hover:border-red-100'
            }`}
          >
            <LogOut className="w-4.5 h-4.5 text-slate-500 hover:text-red-400" />
            <span>Log Out</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        
        {/* Global Header */}
        <header className={`h-18 border-b px-8 flex items-center justify-between shrink-0 z-20 transition-colors duration-300 ${
          isDark ? 'bg-slate-950/45 backdrop-blur-md border-slate-900/60' : 'bg-white border-slate-200'
        }`}>
          
          {/* Advanced Pill Search Controls */}
          <div className="flex items-center gap-3 w-100 relative group">
            <Search className="w-4 h-4 text-slate-500 absolute left-4 transition-colors group-focus-within:text-indigo-400" />
            <input
              type="text"
              placeholder="Search workspaces, templates, flow diagrams..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={`w-full rounded-full pl-10 pr-4 py-2.5 text-xs transition-all outline-none focus:ring-4 focus:ring-indigo-500/10 ${
                isDark 
                  ? 'bg-slate-900/60 border border-slate-900/80 text-white placeholder-slate-600 focus:border-indigo-500/80 focus:bg-slate-950' 
                  : 'bg-slate-100 border border-slate-200 text-slate-800 placeholder-slate-400 focus:border-indigo-500/80 focus:bg-white'
              }`}
            />
          </div>

          {/* Quick Header Actions */}
          <div className="flex items-center gap-4">
            {/* Theme Switcher Button */}
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={toggleTheme}
              className={`p-2.5 border rounded-xl transition-all cursor-pointer ${
                isDark 
                  ? 'text-amber-400 hover:text-amber-300 bg-slate-900/80 hover:bg-slate-800 border-slate-900/80' 
                  : 'text-indigo-600 hover:text-indigo-700 bg-slate-100 hover:bg-slate-200 border-slate-200'
              }`}
              title={isDark ? 'Switch to Light Theme' : 'Switch to Dark Theme'}
            >
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </motion.button>

            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => fetchBoards()}
              className={`p-2.5 border rounded-xl transition-all cursor-pointer ${
                isDark 
                  ? 'text-slate-400 hover:text-white bg-slate-900/80 border-slate-900/80 hover:bg-slate-800' 
                  : 'text-slate-600 hover:text-slate-900 bg-slate-100 border-slate-200 hover:bg-slate-200'
              }`}
              title="Refresh Sync"
            >
              <RefreshCw className="w-4 h-4" />
            </motion.button>
            <div className={`h-6 w-[1px] ${isDark ? 'bg-slate-900' : 'bg-slate-200'}`}></div>
            
            {/* User Indicator */}
            <div className="flex items-center gap-2">
              <span className={`text-xs font-semibold hidden sm:inline ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{userName || 'Collaborator'}</span>
              <div 
                className="w-8.5 h-8.5 rounded-xl flex items-center justify-center font-bold text-xs text-white shadow-md border border-white/10"
                style={{ backgroundColor: userColor }}
              >
                {userAvatar}
              </div>
            </div>
          </div>
        </header>

        {/* Dashboard Frame */}
        <div className="flex-1 p-8 md:p-10 max-w-7xl w-full mx-auto relative">
          
          {/* Custom System Warning Banner */}
          {authWarning && (
            <motion.div 
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-8 bg-amber-950/30 border border-amber-900/40 p-4.5 rounded-2xl flex items-center gap-3.5 text-xs sm:text-sm text-amber-200 shadow-xl shadow-amber-950/10"
            >
              <span className="flex-shrink-0 w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse"></span>
              <div className="leading-relaxed">
                <span className="font-bold">Sandbox Collaboration Session:</span> {authWarning} Rest assured, all canvas operations and boards continue syncing securely via Firestore!
              </div>
            </motion.div>
          )}

          {/* Sub-Views Switch */}
          <AnimatePresence mode="wait">
            {activeTab === 'templates' ? (
              <motion.div
                key="templates-view"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                transition={{ duration: 0.3 }}
              >
                <div className="mb-10">
                  <h2 className="font-display font-extrabold text-3xl text-white tracking-tight mb-2 flex items-center gap-2">
                    <Sparkles className="w-6.5 h-6.5 text-indigo-400" />
                    <span>Workspace Blueprints</span>
                  </h2>
                  <p className="text-slate-400 text-sm max-w-xl">
                    Accelerate your workflow with pre-built collaborative vector environments. Click to launch instantly.
                  </p>
                </div>

                {/* Templates Catalog */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {[
                    {
                      name: 'Mind Map',
                      desc: 'Launch a centralized conceptual brain-mesh with custom color-coded branch pathways and sticky hubs.',
                      color: 'from-purple-600 via-indigo-600 to-purple-600',
                      badge: 'Creative Strategy',
                      tagColor: 'bg-purple-500/10 text-purple-300 border-purple-500/20'
                    },
                    {
                      name: 'Sprint Planning',
                      desc: 'A structural, production-ready agile wall layout mapped into sticky lanes for tasks, ideas, and statuses.',
                      color: 'from-emerald-600 via-teal-600 to-emerald-600',
                      badge: 'Agile Management',
                      tagColor: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
                    },
                    {
                      name: 'System Design',
                      desc: 'A detailed architecture flow chart displaying multi-tier modules, clients, API endpoints, and Firestore databases.',
                      color: 'from-cyan-600 via-blue-600 to-cyan-600',
                      badge: 'Software Architecture',
                      tagColor: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/20'
                    }
                  ].map((tpl) => (
                    <motion.div 
                      key={tpl.name}
                      whileHover={{ y: -6, scale: 1.01 }}
                      className="bg-slate-900/30 rounded-[22px] border border-slate-900/80 shadow-2xl overflow-hidden transition-all duration-300 flex flex-col group cursor-pointer"
                      onClick={() => createBoard(tpl.name)}
                    >
                      <div className={`h-44 bg-gradient-to-tr ${tpl.color} p-6 flex flex-col justify-between relative overflow-hidden`}>
                        <div className="absolute top-0 right-0 w-36 h-36 bg-white/5 rounded-full blur-2xl group-hover:scale-130 transition-transform duration-700"></div>
                        <span className={`backdrop-blur-md text-[10px] font-bold px-3 py-1 rounded-full self-start border ${tpl.tagColor}`}>
                          {tpl.badge}
                        </span>
                        <div className="text-white font-display font-extrabold text-xl tracking-tight">{tpl.name}</div>
                      </div>
                      <div className="p-6 flex-1 flex flex-col justify-between bg-slate-900/40">
                        <p className="text-slate-400 text-xs leading-relaxed mb-6">{tpl.desc}</p>
                        <button className="w-full bg-slate-950/60 hover:bg-indigo-600 hover:text-white text-indigo-400 font-semibold py-2.5 rounded-xl text-xs transition-all duration-200 flex items-center justify-center gap-2 border border-slate-900 group-hover:border-indigo-500/30 cursor-pointer">
                          <Plus className="w-4 h-4" />
                          <span>Use Blueprint</span>
                        </button>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="boards-view"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                transition={{ duration: 0.3 }}
              >
                {/* Board Main Header */}
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-10">
                  <div>
                    <h2 className={`font-display font-black text-4xl tracking-tight mb-2.5 capitalize ${
                      isDark ? 'text-white' : 'text-slate-900'
                    }`}>
                      {activeTab === 'boards' && 'My Sketchboards'}
                      {activeTab === 'shared' && 'Collaborator Channels'}
                      {activeTab === 'trash' && 'Workspace Trash'}
                    </h2>
                    <p className={`${isDark ? 'text-slate-400' : 'text-slate-600'} text-sm max-w-xl`}>
                      {activeTab === 'boards' && 'Draw, whiteboard, and orchestrate visual mindmaps in high-fidelity with zero latency.'}
                      {activeTab === 'shared' && 'Shared structures and planning layouts linked by other connected workspace users.'}
                      {activeTab === 'trash' && 'Restore discarded whiteboard canvases or delete them permanently.'}
                    </p>
                  </div>

                  {activeTab === 'boards' && (
                    <motion.button
                      whileHover={{ scale: 1.02, y: -2 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => setShowCreateModal(true)}
                      className="flex items-center gap-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white px-5.5 py-3 rounded-2xl font-bold text-sm shadow-xl shadow-indigo-950/40 border border-indigo-400/20 cursor-pointer self-start md:self-auto"
                    >
                      <Plus className="w-5 h-5" />
                      <span>New Sketchboard</span>
                    </motion.button>
                  )}
                </div>

                {/* SaaS Performance Metrics Summary Bar */}
                {activeTab === 'boards' && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mb-10">
                    <div className={`p-5 rounded-2xl border flex items-center justify-between transition-colors duration-300 ${
                      isDark ? 'bg-slate-900/20 border-slate-900' : 'bg-white border-slate-200 shadow-sm'
                    }`}>
                      <div>
                        <span className="text-[10px] font-bold text-slate-500 tracking-wider uppercase block mb-1">TOTAL WORKSPACES</span>
                        <span className={`text-2xl font-extrabold ${isDark ? 'text-white' : 'text-slate-900'}`}>{totalOwnBoards}</span>
                      </div>
                      <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center text-indigo-500">
                        <Folder className="w-5 h-5" />
                      </div>
                    </div>
                    <div className={`p-5 rounded-2xl border flex items-center justify-between transition-colors duration-300 ${
                      isDark ? 'bg-slate-900/20 border-slate-900' : 'bg-white border-slate-200 shadow-sm'
                    }`}>
                      <div>
                        <span className="text-[10px] font-bold text-slate-500 tracking-wider uppercase block mb-1">STARRED CANVASES</span>
                        <span className={`text-2xl font-extrabold ${isDark ? 'text-white' : 'text-slate-900'}`}>{starredBoardsCount}</span>
                      </div>
                      <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-500">
                        <Star className="w-5 h-5 fill-amber-500/10" />
                      </div>
                    </div>
                    <div className={`p-5 rounded-2xl border flex items-center justify-between transition-colors duration-300 ${
                      isDark ? 'bg-slate-900/20 border-slate-900' : 'bg-white border-slate-200 shadow-sm'
                    }`}>
                      <div>
                        <span className="text-[10px] font-bold text-slate-500 tracking-wider uppercase block mb-1">COLLABORATION LEVEL</span>
                        <span className={`text-2xl font-extrabold ${isDark ? 'text-white' : 'text-slate-900'}`}>Real-Time</span>
                      </div>
                      <div className="w-10 h-10 rounded-xl bg-cyan-500/10 flex items-center justify-center text-cyan-500">
                        <Users className="w-5 h-5" />
                      </div>
                    </div>
                  </div>
                )}

                {/* Skeletons/Cards Container */}
                {loadingBoards ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {[1, 2, 3, 4].map((n) => (
                      <div 
                        key={n} 
                        className={`border rounded-2xl overflow-hidden flex flex-col animate-pulse ${
                          isDark ? 'bg-slate-900/30 border-slate-900' : 'bg-white border-slate-200/80 shadow-sm'
                        }`}
                      >
                        <div className={`aspect-[16/10] w-full relative ${isDark ? 'bg-slate-950/70' : 'bg-slate-100'}`}>
                          <div className="absolute top-3 right-3 flex gap-1.5">
                            <div className={`w-8 h-8 rounded-xl ${isDark ? 'bg-slate-850' : 'bg-slate-200'}`} />
                            <div className={`w-8 h-8 rounded-xl ${isDark ? 'bg-slate-850' : 'bg-slate-200'}`} />
                          </div>
                        </div>
                        <div className="p-5 flex-1 flex flex-col justify-between">
                          <div className="space-y-3">
                            <div className={`h-4 rounded-lg w-2/3 ${isDark ? 'bg-slate-800' : 'bg-slate-200'}`} />
                            <div className="flex gap-2">
                              <div className={`h-3 rounded-lg w-1/4 ${isDark ? 'bg-slate-850' : 'bg-slate-200'}`} />
                              <div className={`h-3 rounded-lg w-1/3 ${isDark ? 'bg-slate-850' : 'bg-slate-200'}`} />
                            </div>
                            <div className="flex gap-1.5 pt-1">
                              <div className={`h-5 rounded-lg w-12 ${isDark ? 'bg-indigo-500/10' : 'bg-indigo-500/5'}`} />
                              <div className={`h-5 rounded-lg w-16 ${isDark ? 'bg-indigo-500/10' : 'bg-indigo-500/5'}`} />
                            </div>
                          </div>
                          <div className="mt-6 pt-4 border-t border-dashed border-slate-950/10 flex justify-between items-center">
                            <div className="flex -space-x-1">
                              <div className={`w-6.5 h-6.5 rounded-full ${isDark ? 'bg-slate-800' : 'bg-slate-200'}`} />
                              <div className={`w-6.5 h-6.5 rounded-full ${isDark ? 'bg-slate-850' : 'bg-slate-300'}`} />
                            </div>
                            <div className={`w-12 h-6 rounded-lg ${isDark ? 'bg-slate-850' : 'bg-slate-200'}`} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : filteredList.length === 0 ? (
                  <div className={`flex flex-col items-center justify-center py-24 border border-dashed rounded-[24px] p-8 text-center transition-all duration-300 ${
                    isDark ? 'bg-slate-900/10 border-slate-800/80 shadow-black/25' : 'bg-slate-50 border-slate-200 shadow-inner'
                  }`}>
                    <div className={`w-14 h-14 rounded-2xl border flex items-center justify-center mb-5 shadow-lg ${
                      isDark ? 'bg-slate-950/60 border-slate-800/60 text-slate-400' : 'bg-white border-slate-200 text-slate-500'
                    }`}>
                      <FolderOpen className="w-6.5 h-6.5" />
                    </div>
                    <h3 className={`font-display font-black text-xl mb-1.5 tracking-tight ${
                      isDark ? 'text-slate-100' : 'text-slate-800'
                    }`}>
                      {activeTab === 'boards' && 'No Whiteboards Registered'}
                      {activeTab === 'shared' && 'No Shared Whiteboards Yet'}
                      {activeTab === 'trash' && 'Trash is Completely Clean'}
                    </h3>
                    <p className={`text-xs max-w-sm mb-6 leading-relaxed font-medium ${
                      isDark ? 'text-slate-400' : 'text-slate-500'
                    }`}>
                      {activeTab === 'boards' && 'Initiate your very first live vector-collaborative drawing canvas and invite editing teams.'}
                      {activeTab === 'shared' && 'Ask other users to provide their private workspace link or custom ID for immediate access.'}
                      {activeTab === 'trash' && 'Discarded boards are archived here. You may permanently delete them or pull them back.'}
                    </p>
                    {activeTab === 'boards' && (
                      <button
                        onClick={() => setShowCreateModal(true)}
                        className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-5 py-3 rounded-2xl text-xs shadow-xl shadow-indigo-950/40 transition-all hover:scale-[1.02] active:scale-98 duration-150 cursor-pointer border border-indigo-400/20"
                      >
                        Create Workspace
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {filteredList.map((board, index) => {
                      const isStarred = favorites.includes(board.id);
                      const coverImg = COVER_IMAGES[index % COVER_IMAGES.length];
                      
                      return (
                        <motion.div
                          key={board.id}
                          layoutId={`board-card-${board.id}`}
                          whileHover={{ y: -5 }}
                          onClick={() => onSelectBoard(board.id)}
                          className={`group relative border rounded-2xl overflow-hidden shadow-xl transition-all duration-300 flex flex-col cursor-pointer ${
                            isDark 
                              ? 'bg-slate-900/30 border-slate-900 hover:border-slate-850 shadow-black/40' 
                              : 'bg-white border-slate-200/80 hover:border-slate-300 hover:shadow-indigo-500/5'
                          }`}
                        >
                          {/* Vibrant Cover Image Header */}
                          <div className="aspect-[16/10] w-full bg-slate-950 overflow-hidden relative">
                            <img
                              src={coverImg}
                              alt={board.title}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 opacity-80"
                              loading="lazy"
                            />
                            
                            {/* Colorful strip accent */}
                            <div className="absolute top-0 inset-x-0 h-[3px] bg-gradient-to-r from-indigo-500 via-purple-500 to-cyan-400"></div>

                            {/* Overlaid visual triggers */}
                            <div className="absolute inset-0 bg-slate-950/50 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center">
                              <span className="text-white bg-indigo-600/90 backdrop-blur-md px-4 py-2 rounded-xl font-bold text-xs shadow-xl border border-indigo-400/20">
                                Open Sandbox
                              </span>
                            </div>

                            {/* Top right quick actions */}
                            <div className="absolute top-3 right-3 flex gap-1.5 z-10">
                              <button
                                onClick={(e) => toggleFavorite(board.id, e)}
                                className="p-2 rounded-xl bg-slate-950/80 hover:bg-slate-900 text-slate-400 hover:text-amber-400 border border-slate-900 shadow-xl transition-all cursor-pointer"
                                title={isStarred ? "Remove Favorite" : "Favorite"}
                              >
                                <Star className={`w-3.5 h-3.5 ${isStarred ? 'fill-amber-400 text-amber-400' : ''}`} />
                              </button>
                              {activeTab !== 'trash' && (
                                <button
                                  onClick={(e) => copyShareLink(board.id, e)}
                                  className="p-2 rounded-xl bg-slate-950/80 hover:bg-slate-900 text-slate-400 hover:text-indigo-400 border border-slate-900 shadow-xl transition-all cursor-pointer"
                                  title="Copy Invite Link"
                                >
                                  {copiedBoardId === board.id ? (
                                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                                  ) : (
                                    <Share2 className="w-3.5 h-3.5" />
                                  )}
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Details Footer */}
                          <div className={`p-5 flex flex-col justify-between flex-1 transition-colors duration-300 ${
                            isDark ? 'bg-slate-900/10' : 'bg-slate-50/50'
                          }`}>
                            <div>
                              <h3 className={`font-bold group-hover:text-indigo-500 transition-colors text-base truncate mb-1 ${
                                isDark ? 'text-white' : 'text-slate-800'
                              }`}>
                                {board.title}
                              </h3>
                              <div className="flex items-center gap-2 text-[10px] text-slate-500 font-semibold uppercase tracking-wider">
                                <Clock className="w-3.5 h-3.5 text-slate-600" />
                                <span>{new Date(board.createdAt).toLocaleDateString()}</span>
                                <span className="text-slate-700">•</span>
                                <span className="truncate">By {board.ownerName}</span>
                              </div>
                              {/* Display Tags */}
                              {board.tags && board.tags.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-2.5">
                                  {board.tags.map(tag => (
                                    <span key={tag} className="px-2 py-0.5 rounded-lg bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 text-[9px] font-bold">
                                      #{tag}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>

                            <div className="mt-5 pt-3.5 border-t border-slate-950 flex items-center justify-between">
                              {/* Collaborator Profile Indicators */}
                              <div className="flex -space-x-1.5 overflow-hidden">
                                <div className="w-6.5 h-6.5 rounded-full bg-indigo-600 border border-slate-950 flex items-center justify-center text-[9px] text-white font-extrabold shadow">
                                  {board.ownerName.slice(0, 2).toUpperCase()}
                                </div>
                                <div className="w-6.5 h-6.5 rounded-full bg-slate-800 border border-slate-950 flex items-center justify-center text-[9px] text-slate-400 font-extrabold shadow">
                                  +
                                </div>
                              </div>

                              {/* Options to Delete / Restore */}
                              <div className="flex items-center gap-1">
                                {activeTab === 'trash' ? (
                                  <>
                                    <button
                                      onClick={(e) => restoreBoard(board.id, e)}
                                      className="px-2.5 py-1.5 text-xs font-bold text-emerald-400 hover:bg-emerald-950/20 rounded-lg transition-all border border-emerald-950 cursor-pointer"
                                    >
                                      Restore
                                    </button>
                                    <button
                                      onClick={(e) => permanentlyDeleteBoard(board.id, e)}
                                      className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-950/25 rounded-lg transition-all cursor-pointer border border-transparent"
                                      title="Delete Permanently"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  </>
                                ) : (
                                  <div className="flex items-center gap-1">
                                    {board.ownerId === user?.uid && (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setEditingBoard(board);
                                          setEditBoardTitle(board.title);
                                          setEditBoardTags(board.tags ? board.tags.join(', ') : '');
                                        }}
                                        className="p-1.5 text-slate-500 hover:text-indigo-400 hover:bg-indigo-950/20 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 cursor-pointer border border-transparent"
                                        title="Edit Board Details"
                                      >
                                        <Settings className="w-4 h-4" />
                                      </button>
                                    )}
                                    {board.ownerId === user?.uid && (
                                      <button
                                        onClick={(e) => softDeleteBoard(board.id, e)}
                                        className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-950/20 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 cursor-pointer border border-transparent"
                                        title="Move to Trash"
                                      >
                                        <Trash2 className="w-4 h-4" />
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* Modern Create Board Modal (Figma / Linear inspired) */}
      <AnimatePresence>
        {showCreateModal && (
          <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="bg-slate-900 border border-slate-800/80 w-full max-w-md rounded-[22px] overflow-hidden shadow-2xl relative"
            >
              <div className="px-6 py-4.5 bg-slate-950/40 border-b border-slate-900/60 flex items-center justify-between">
                <h3 className="font-display font-bold text-lg text-white tracking-tight">Create Collaborative Board</h3>
                <button 
                  onClick={() => setShowCreateModal(false)}
                  className="p-1.5 text-slate-500 hover:text-white hover:bg-slate-800/50 rounded-xl transition-all cursor-pointer"
                >
                  <X className="w-4.5 h-4.5" />
                </button>
              </div>

              <div className="p-6 space-y-5">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2 ml-1">
                    Board Title
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. System Architecture Design"
                    value={newBoardTitle}
                    onChange={(e) => setNewBoardTitle(e.target.value)}
                    className="w-full bg-slate-950/80 border border-slate-850 focus:border-indigo-500/80 focus:bg-slate-950 rounded-2xl px-4 py-3 text-sm text-white transition-all outline-none focus:ring-4 focus:ring-indigo-500/10 placeholder-slate-700 font-medium"
                    autoFocus
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2 ml-1">
                    Content Tags (comma separated)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. sprint, ideas, mindmap"
                    value={newBoardTags}
                    onChange={(e) => setNewBoardTags(e.target.value)}
                    className="w-full bg-slate-950/80 border border-slate-850 focus:border-indigo-500/80 focus:bg-slate-950 rounded-2xl px-4 py-3 text-sm text-white transition-all outline-none focus:ring-4 focus:ring-indigo-500/10 placeholder-slate-700 font-medium"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2 ml-1">
                    Workspace Permission Profile
                  </label>
                  <div className="grid grid-cols-2 gap-3.5">
                    <button
                      type="button"
                      onClick={() => setNewBoardPermission('editor')}
                      className={`flex flex-col items-start p-4 rounded-2xl border text-left transition-all cursor-pointer ${
                        newBoardPermission === 'editor'
                          ? 'border-indigo-500 bg-indigo-950/30 text-white ring-4 ring-indigo-500/10'
                          : 'border-slate-800/60 bg-slate-950/40 text-slate-500 hover:bg-slate-950'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <Globe className={`w-4 h-4 ${newBoardPermission === 'editor' ? 'text-indigo-400' : 'text-slate-600'}`} />
                        <span className={`font-bold text-xs ${newBoardPermission === 'editor' ? 'text-indigo-300' : 'text-slate-400'}`}>Public Editor</span>
                      </div>
                      <p className="text-[10px] text-slate-500 leading-relaxed font-medium">
                        Anyone with the shared board link can join and draw instantly.
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() => setNewBoardPermission('owner')}
                      className={`flex flex-col items-start p-4 rounded-2xl border text-left transition-all cursor-pointer ${
                        newBoardPermission === 'owner'
                          ? 'border-indigo-500 bg-indigo-950/30 text-white ring-4 ring-indigo-500/10'
                          : 'border-slate-800/60 bg-slate-950/40 text-slate-500 hover:bg-slate-950'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <Lock className={`w-4 h-4 ${newBoardPermission === 'owner' ? 'text-purple-400' : 'text-slate-600'}`} />
                        <span className={`font-bold text-xs ${newBoardPermission === 'owner' ? 'text-purple-300' : 'text-slate-400'}`}>Only Creator</span>
                      </div>
                      <p className="text-[10px] text-slate-500 leading-relaxed font-medium">
                        Only the board owner is permitted to modify or update elements.
                      </p>
                    </button>
                  </div>
                </div>

                {createError && (
                  <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs px-4 py-3 rounded-2xl font-semibold flex items-center gap-2">
                    <span>{createError}</span>
                  </div>
                )}
              </div>

              <div className="px-6 py-4 bg-slate-950/40 border-t border-slate-900/60 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4.5 py-2.5 text-xs font-semibold text-slate-400 hover:text-white rounded-xl transition-all cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isCreating}
                  onClick={() => createBoard()}
                  className="px-5.5 py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-xs font-bold rounded-xl shadow-lg shadow-indigo-950/25 transition-all border border-indigo-400/20 cursor-pointer"
                >
                  {isCreating ? 'Creating...' : 'Create Board'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modern Edit Board Modal */}
      <AnimatePresence>
        {editingBoard && (
          <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="bg-slate-900 border border-slate-800/80 w-full max-w-md rounded-[22px] overflow-hidden shadow-2xl relative"
            >
              <div className="px-6 py-4.5 bg-slate-950/40 border-b border-slate-900/60 flex items-center justify-between">
                <h3 className="font-display font-bold text-lg text-white tracking-tight flex items-center gap-2">
                  <Tag className="w-5 h-5 text-indigo-400" />
                  <span>Edit Board Details</span>
                </h3>
                <button 
                  onClick={() => setEditingBoard(null)}
                  className="p-1.5 text-slate-500 hover:text-white hover:bg-slate-800/50 rounded-xl transition-all cursor-pointer"
                >
                  <X className="w-4.5 h-4.5" />
                </button>
              </div>

              <div className="p-6 space-y-5">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2 ml-1">
                    Board Title
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. My Awesome Board"
                    value={editBoardTitle}
                    onChange={(e) => setEditBoardTitle(e.target.value)}
                    className="w-full bg-slate-950/80 border border-slate-850 focus:border-indigo-500/80 focus:bg-slate-950 rounded-2xl px-4 py-3 text-sm text-white transition-all outline-none focus:ring-4 focus:ring-indigo-500/10 placeholder-slate-700 font-medium"
                    autoFocus
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2 ml-1">
                    Content Tags (comma separated)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. agile, brainstorm, visual-flow"
                    value={editBoardTags}
                    onChange={(e) => setEditBoardTags(e.target.value)}
                    className="w-full bg-slate-950/80 border border-slate-850 focus:border-indigo-500/80 focus:bg-slate-950 rounded-2xl px-4 py-3 text-sm text-white transition-all outline-none focus:ring-4 focus:ring-indigo-500/10 placeholder-slate-700 font-medium"
                  />
                  <p className="text-[10px] text-slate-500 leading-relaxed font-medium mt-1.5 ml-1">
                    Tags help you categorize and search boards quickly using our fuzzy matching search bar.
                  </p>
                </div>
              </div>

              <div className="px-6 py-4 bg-slate-950/40 border-t border-slate-900/60 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setEditingBoard(null)}
                  className="px-4.5 py-2.5 text-xs font-semibold text-slate-400 hover:text-white rounded-xl transition-all cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isUpdatingBoard}
                  onClick={updateBoardDetails}
                  className="px-5.5 py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-xs font-bold rounded-xl shadow-lg shadow-indigo-950/25 transition-all border border-indigo-400/20 cursor-pointer"
                >
                  {isUpdatingBoard ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
