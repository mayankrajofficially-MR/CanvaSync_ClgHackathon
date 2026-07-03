import React, { useRef, useState, useEffect } from 'react';
import { 
  MousePointer, 
  Hand,
  Pencil, 
  Square, 
  Circle, 
  Minus, 
  Type, 
  StickyNote, 
  Eraser, 
  Zap, 
  Undo, 
  Redo, 
  ZoomIn, 
  ZoomOut, 
  Trash, 
  Download, 
  Share2, 
  Send, 
  MessageSquare, 
  X, 
  ChevronLeft, 
  ChevronRight, 
  Plus, 
  Sun, 
  Moon, 
  Home, 
  ArrowLeft,
  Copy,
  Check,
  CheckCircle,
  Eye,
  Sliders,
  Image as ImageIcon,
  Lock,
  Globe,
  Edit3
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { db } from '../lib/firebase';
import { 
  collection, 
  doc, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  setDoc,
  query,
  orderBy,
  limit
} from 'firebase/firestore';
import { 
  ToolType, 
  Point, 
  Board, 
  BoardElement, 
  CursorPresence, 
  ChatMessage,
  PencilElement,
  LineElement,
  RectangleElement,
  CircleElement,
  TextElement,
  StickyElement
} from '../types';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { MiniMap } from './MiniMap';

interface WhiteboardProps {
  boardId: string;
  onBackToDashboard: () => void;
}

export const Whiteboard: React.FC<WhiteboardProps> = ({ boardId, onBackToDashboard }) => {
  const { user, userName, userColor, userAvatar, authWarning } = useAuth();
  
  // Board details
  const [board, setBoard] = useState<Board | null>(null);
  const currentUserRole: 'owner' | 'editor' | 'viewer' = (() => {
    if (!board) return 'viewer';
    if (board.ownerId === user?.uid) return 'owner';
    if (board.permissions && user && board.permissions[user.uid]) {
      return board.permissions[user.uid] as 'owner' | 'editor' | 'viewer';
    }
    if (board.permissions && user?.email && board.permissions[user.email.toLowerCase()]) {
      return board.permissions[user.email.toLowerCase()] as 'owner' | 'editor' | 'viewer';
    }
    if (board.collaborators && user?.email && board.collaborators.map((c: string) => c.toLowerCase()).includes(user.email.toLowerCase())) {
      return 'editor';
    }
    return 'viewer';
  })();
  const [elements, setElements] = useState<BoardElement[]>([]);
  const [cursors, setCursors] = useState<{ [userId: string]: CursorPresence }>({});
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  
  // Real-time Level 2 presence & email invitations
  interface UserPresence {
    userId: string;
    userName: string;
    userColor: string;
    userAvatar: string;
    lastActive: number;
  }
  const [activeUsers, setActiveUsers] = useState<{ [userId: string]: UserPresence }>({});
  const [inviteEmail, setInviteEmail] = useState<string>('');
  const [inviteError, setInviteError] = useState<string>('');
  const [isInspectorOpenMobile, setIsInspectorOpenMobile] = useState<boolean>(false);
  
  // Controls & Tool settings
  const [activeTool, setActiveTool] = useState<ToolType>('pencil');
  const [strokeColor, setStrokeColor] = useState<string>('#3b82f6');
  const [strokeWidth, setStrokeWidth] = useState<number>(4);
  const [opacity, setOpacity] = useState<number>(1);
  const [fontFamily, setFontFamily] = useState<string>('sans');
  const [fillColor, setFillColor] = useState<string>('transparent');

  // Multi-page state
  const [currentPage, setCurrentPage] = useState<number>(0);

  // Layout Zoom/Pan
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const panStart = useRef<Point>({ x: 0, y: 0 });

  // Sidebar / Drawers
  const [isChatOpen, setIsChatOpen] = useState<boolean>(false);
  const [chatInput, setChatInput] = useState<string>('');
  const [showInviteModal, setShowInviteModal] = useState<boolean>(false);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);
  const { isDark: isDarkTheme, toggleTheme: toggleGlobalTheme } = useTheme();

  // Canvas Drawing States
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isDrawing = useRef<boolean>(false);
  const drawingStart = useRef<Point>({ x: 0, y: 0 });
  
  // For rendering shapes in real-time locally before committing
  const [localTempElement, setLocalTempElement] = useState<any | null>(null);
  const [pencilPoints, setPencilPoints] = useState<Point[]>([]);

  // Selection state
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [isDraggingElement, setIsDraggingElement] = useState<boolean>(false);
  const dragOffset = useRef<Point>({ x: 0, y: 0 });
  const [activeResizeHandle, setActiveResizeHandle] = useState<'nw' | 'ne' | 'sw' | 'se' | null>(null);
  const [canvasCursor, setCanvasCursor] = useState<string>('default');
  const [isSpacePressed, setIsSpacePressed] = useState<boolean>(false);
  const touchStartDist = useRef<number | null>(null);
  const touchStartZoom = useRef<number>(1);
  const touchStartPan = useRef<Point>({ x: 0, y: 0 });
  const touchStartMidpoint = useRef<Point>({ x: 0, y: 0 });
  const isPinchZooming = useRef<boolean>(false);

  // For editable Text / Sticky note overlay
  const [editingTextElement, setEditingTextElement] = useState<{
    id: string;
    type: 'text' | 'sticky';
    x: number;
    y: number;
    text: string;
    bgColor?: string;
  } | null>(null);

  // Laser Pointer Live points
  const [laserPath, setLaserPath] = useState<Point[]>([]);
  const laserTimer = useRef<any>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // Undo / Redo stacks
  const [undoStack, setUndoStack] = useState<any[]>([]);
  const [redoStack, setRedoStack] = useState<any[]>([]);

  // 1. Listen to Board Document
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'boards', boardId), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data() as Board;
        setBoard({ id: docSnap.id, ...data });
        if (data.currentPage !== undefined) {
          setCurrentPage(data.currentPage);
        }
      }
    });
    return unsub;
  }, [boardId]);

  // 2. Listen to Elements Subcollection
  useEffect(() => {
    const q = query(collection(db, 'boards', boardId, 'elements'), orderBy('createdAt', 'asc'));
    const unsub = onSnapshot(q, (snapshot) => {
      const els: BoardElement[] = [];
      snapshot.forEach((docSnap) => {
        els.push({ id: docSnap.id, ...docSnap.data() } as BoardElement);
      });
      setElements(els);
    });
    return unsub;
  }, [boardId]);

  // 3. Listen to Cursors (Presence) Subcollection
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'boards', boardId, 'cursors'), (snapshot) => {
      const cur: { [userId: string]: CursorPresence } = {};
      snapshot.forEach((docSnap) => {
        const data = docSnap.data() as CursorPresence;
        // Ignore self and expired cursors (> 10s old)
        if (data.userId !== user?.uid && Date.now() - data.lastActive < 10000) {
          cur[data.userId] = data;
        }
      });
      setCursors(cur);
    });
    return unsub;
  }, [boardId, user]);

  // 4. Listen to Chat Messages Subcollection
  useEffect(() => {
    const q = query(
      collection(db, 'boards', boardId, 'messages'),
      orderBy('createdAt', 'desc'),
      limit(50)
    );
    const unsub = onSnapshot(q, (snapshot) => {
      const msgs: ChatMessage[] = [];
      snapshot.forEach((docSnap) => {
        msgs.push({ id: docSnap.id, ...docSnap.data() } as ChatMessage);
      });
      // Sort ascending for chat stream
      setMessages(msgs.reverse());
    });
    return unsub;
  }, [boardId]);

  // Scroll to bottom of chat when new messages arrive or chat opens
  useEffect(() => {
    if (isChatOpen && chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isChatOpen]);

  const isInputActive = (): boolean => {
    const active = document.activeElement;
    if (!active) return false;
    const tag = active.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || active.hasAttribute('contenteditable');
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isInputActive()) {
        setIsSpacePressed(true);
        // Prevent browser default page scroll when space is pressed on body or canvas
        if (document.activeElement === document.body || document.activeElement?.tagName.toLowerCase() === 'canvas') {
          e.preventDefault();
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsSpacePressed(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // 5. Level 2 Real-Time Presence Heartbeat & Listeners
  useEffect(() => {
    if (!user) return;

    const presenceDocRef = doc(db, 'boards', boardId, 'presence', user.uid);
    
    // Heartbeat function
    const updatePresence = async () => {
      try {
        await setDoc(presenceDocRef, {
          userId: user.uid,
          userName: userName || 'Anonymous',
          userColor: userColor || '#ef4444',
          userAvatar: userAvatar || '👤',
          lastActive: Date.now()
        }, { merge: true });
      } catch (err) {
        console.warn("Presence heartbeat failed:", err);
      }
    };

    // Trigger immediately
    updatePresence();

    // Heartbeat interval (every 4 seconds)
    const interval = setInterval(updatePresence, 4000);

    // Listen to all active users on this board
    const unsub = onSnapshot(collection(db, 'boards', boardId, 'presence'), (snapshot) => {
      const active: { [userId: string]: UserPresence } = {};
      snapshot.forEach((docSnap) => {
        const data = docSnap.data() as UserPresence;
        // Keep active users who sent a heartbeat in the last 10 seconds
        if (Date.now() - data.lastActive < 10000) {
          active[data.userId] = data;
        }
      });
      setActiveUsers(active);
    });

    // Clean up on unmount (delete presence doc)
    return () => {
      clearInterval(interval);
      unsub();
      deleteDoc(presenceDocRef).catch(e => console.warn("Presence cleanup failed", e));
    };
  }, [boardId, user, userName, userColor, userAvatar]);

  // Clean up expired cursors occasionally
  useEffect(() => {
    const interval = setInterval(async () => {
      // Just a simple clean up locally
      setCursors((prev) => {
        const clean: { [userId: string]: CursorPresence } = {};
        Object.entries(prev).forEach(([uid, curVal]) => {
          const cur = curVal as CursorPresence;
          if (Date.now() - cur.lastActive < 10000) {
            clean[uid] = cur;
          }
        });
        return clean;
      });
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  // Sync cursor position throttled
  const lastCursorUpdate = useRef<number>(0);
  const syncCursorPosition = async (point: Point, isLaser: boolean = false) => {
    if (!user) return;
    const now = Date.now();
    if (now - lastCursorUpdate.current < 50) return; // limit writes to 50ms (around 20 per second)
    lastCursorUpdate.current = now;

    try {
      const cursorRef = doc(db, 'boards', boardId, 'cursors', user.uid);
      await setDoc(cursorRef, {
        userId: user.uid,
        userName: userName || 'Anonymous',
        userColor: userColor || '#ef4444',
        x: point.x,
        y: point.y,
        lastActive: Date.now(),
        laserPoints: isLaser ? laserPath : []
      });
    } catch (err) {
      console.warn("Cursor sync error", err);
    }
  };

  // 5. Draw Canvas loop
  useEffect(() => {
    renderCanvas();
  }, [elements, localTempElement, cursors, zoom, pan, activeTool, selectedElementId, pencilPoints, laserPath, isDarkTheme, currentPage]);

  // Resize listener
  useEffect(() => {
    const handleResize = () => {
      if (canvasRef.current && containerRef.current) {
        const dpr = window.devicePixelRatio || 1;
        const rect = containerRef.current.getBoundingClientRect();
        canvasRef.current.width = rect.width * dpr;
        canvasRef.current.height = rect.height * dpr;
        canvasRef.current.style.width = `${rect.width}px`;
        canvasRef.current.style.height = `${rect.height}px`;
        renderCanvas();
      }
    };
    window.addEventListener('resize', handleResize);
    // Initial size
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
  }, [containerRef.current, elements, isDarkTheme]);

  // Get dynamic Canvas Coordinates mapping zoom and pan
  const getCanvasCoords = (e: React.MouseEvent | React.TouchEvent): Point => {
    if (!canvasRef.current) return { x: 0, y: 0 };
    const rect = canvasRef.current.getBoundingClientRect();
    
    let clientX = 0;
    let clientY = 0;
    
    if ('touches' in e) {
      if (e.touches.length === 0) return { x: 0, y: 0 };
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    const localX = clientX - rect.left;
    const localY = clientY - rect.top;

    // Convert screen coordinates to world coordinates by applying inverse Pan and Zoom
    return {
      x: (localX - pan.x) / zoom,
      y: (localY - pan.y) / zoom
    };
  };

  const zoomAtPoint = (newZoom: number, focusScreenX: number, focusScreenY: number) => {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const px = focusScreenX - rect.left;
    const py = focusScreenY - rect.top;

    const clampedZoom = Math.max(0.1, Math.min(5, newZoom));
    const factor = clampedZoom / zoom;

    setPan({
      x: px - (px - pan.x) * factor,
      y: py - (py - pan.y) * factor
    });
    setZoom(clampedZoom);
  };

  const zoomInViewportCenter = (factor: number) => {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    zoomAtPoint(zoom * factor, centerX, centerY);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      
      if (e.ctrlKey) {
        // Zooming focusing on mouse cursor position
        const zoomFactor = 1 - e.deltaY * 0.005;
        const newZoom = Math.max(0.1, Math.min(5, zoom * zoomFactor));
        zoomAtPoint(newZoom, e.clientX, e.clientY);
      } else {
        // Panning: deltaX and deltaY of wheel/touchpad
        const dx = e.shiftKey ? -e.deltaY : -e.deltaX;
        const dy = e.shiftKey ? 0 : -e.deltaY;
        setPan(prev => ({ x: prev.x + dx, y: prev.y + dy }));
      }
    };

    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      canvas.removeEventListener('wheel', handleWheel);
    };
  }, [zoom, pan]);

  // Canvas drawing renderer
  const renderCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Apply scaling for High-DPI screens
    ctx.scale(dpr, dpr);

    // Save initial state, then apply translation and zoom
    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);

    // 1. Draw grid background
    drawGridBackground(ctx, canvas.width / dpr, canvas.height / dpr);

    // 2. Draw active remote board elements (filtered by current page)
    const pageFilteredElements = elements.filter(el => (el.page || 0) === currentPage);
    pageFilteredElements.forEach((el) => {
      drawElement(ctx, el);
    });

    // 3. Draw local temporary element (drawn while dragging or creating)
    if (localTempElement) {
      drawElement(ctx, localTempElement);
    }

    // 4. Draw selection bounding box if we have a selected element
    if (selectedElementId && activeTool === 'select') {
      const selected = elements.find(el => el.id === selectedElementId);
      if (selected && (selected.page || 0) === currentPage) {
        drawSelectionBox(ctx, selected);
      }
    }

    // 5. Draw active lasers (glowing neon paths)
    if (laserPath.length > 1) {
      drawLaserPath(ctx, laserPath, userColor || '#ef4444');
    }

    // 6. Draw other connected users' cursors and lasers
    Object.values(cursors).forEach((curVal) => {
      const cur = curVal as CursorPresence;
      // Draw remote laser
      if (cur.laserPoints && cur.laserPoints.length > 1) {
        drawLaserPath(ctx, cur.laserPoints, cur.userColor);
      }
      // Draw remote cursor icon
      drawRemoteCursor(ctx, cur);
    });

    ctx.restore();
  };

  const drawGridBackground = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    // We draw dots based on current panning and zoom
    const dotSpacing = 24;
    const gridColor = isDarkTheme ? 'rgba(255, 255, 255, 0.15)' : 'rgba(194, 198, 216, 0.5)';

    // Start coordinates in world space
    const startX = Math.floor((-pan.x / zoom) / dotSpacing) * dotSpacing - dotSpacing;
    const startY = Math.floor((-pan.y / zoom) / dotSpacing) * dotSpacing - dotSpacing;

    const endX = startX + (width / zoom) + dotSpacing * 2;
    const endY = startY + (height / zoom) + dotSpacing * 2;

    ctx.fillStyle = gridColor;
    for (let x = startX; x < endX; x += dotSpacing) {
      for (let y = startY; y < endY; y += dotSpacing) {
        ctx.beginPath();
        ctx.arc(x, y, 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  };

  const drawElement = (ctx: CanvasRenderingContext2D, el: BoardElement) => {
    ctx.save();
    ctx.strokeStyle = el.color;
    ctx.fillStyle = el.color;
    ctx.lineWidth = el.strokeWidth;
    ctx.globalAlpha = el.opacity ?? 1;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    switch (el.type) {
      case 'pencil':
        if (el.points && el.points.length > 0) {
          ctx.beginPath();
          ctx.moveTo(el.points[0].x, el.points[0].y);
          for (let i = 1; i < el.points.length; i++) {
            const xc = (el.points[i - 1].x + el.points[i].x) / 2;
            const yc = (el.points[i - 1].y + el.points[i].y) / 2;
            ctx.quadraticCurveTo(el.points[i - 1].x, el.points[i - 1].y, xc, yc);
          }
          ctx.stroke();
        }
        break;

      case 'line':
        ctx.beginPath();
        ctx.moveTo(el.x1, el.y1);
        ctx.lineTo(el.x2, el.y2);
        ctx.stroke();
        break;

      case 'rectangle':
        ctx.beginPath();
        if (el.fillColor && el.fillColor !== 'transparent') {
          ctx.fillStyle = el.fillColor;
          ctx.fillRect(el.x, el.y, el.width, el.height);
        }
        ctx.rect(el.x, el.y, el.width, el.height);
        ctx.stroke();
        break;

      case 'circle':
        ctx.beginPath();
        ctx.ellipse(el.cx, el.cy, Math.abs(el.rx), Math.abs(el.ry), 0, 0, Math.PI * 2);
        if (el.fillColor && el.fillColor !== 'transparent') {
          ctx.fillStyle = el.fillColor;
          ctx.fill();
        }
        ctx.stroke();
        break;

      case 'text':
        ctx.font = `${el.fontSize}px ${el.fontFamily === 'mono' ? 'JetBrains Mono' : el.fontFamily === 'serif' ? 'Playfair Display' : 'Inter'}`;
        ctx.textBaseline = 'top';
        ctx.fillText(el.text, el.x, el.y);
        break;

      case 'sticky':
        // Draw elegant rounded paper card shadow
        ctx.shadowColor = 'rgba(0, 0, 0, 0.1)';
        ctx.shadowBlur = 12;
        ctx.shadowOffsetX = 2;
        ctx.shadowOffsetY = 4;

        // Draw card background
        ctx.fillStyle = el.bgColor || '#fef08a';
        ctx.beginPath();
        // Custom round rect helper
        ctx.roundRect?.(el.x, el.y, el.width, el.height, 12);
        ctx.fill();

        // Reset shadow for text
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;

        // Draw card outline
        ctx.strokeStyle = 'rgba(0,0,0,0.06)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Draw Card Header Accent
        ctx.fillStyle = 'rgba(0, 0, 0, 0.03)';
        ctx.beginPath();
        ctx.roundRect?.(el.x, el.y, el.width, 24, [12, 12, 0, 0]);
        ctx.fill();

        // Draw text inside note card
        ctx.fillStyle = '#1e293b';
        ctx.font = `500 13px Inter`;
        ctx.textBaseline = 'top';

        // Wrap text neatly
        const padding = 16;
        const maxTextWidth = el.width - padding * 2;
        const words = el.text.split(' ');
        let line = '';
        let currentY = el.y + 32;

        for (let n = 0; n < words.length; n++) {
          let testLine = line + words[n] + ' ';
          let metrics = ctx.measureText(testLine);
          let testWidth = metrics.width;
          if (testWidth > maxTextWidth && n > 0) {
            ctx.fillText(line, el.x + padding, currentY);
            line = words[n] + ' ';
            currentY += 18;
          } else {
            line = testLine;
          }
        }
        ctx.fillText(line, el.x + padding, currentY);
        break;
    }
    ctx.restore();
  };

  const drawSelectionBox = (ctx: CanvasRenderingContext2D, el: BoardElement) => {
    ctx.save();
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);

    let x = 0, y = 0, w = 0, h = 0;

    if (el.type === 'rectangle' || el.type === 'sticky') {
      x = el.x;
      y = el.y;
      w = el.width;
      h = el.height;
    } else if (el.type === 'circle') {
      x = el.cx - Math.abs(el.rx);
      y = el.cy - Math.abs(el.ry);
      w = Math.abs(el.rx) * 2;
      h = Math.abs(el.ry) * 2;
    } else if (el.type === 'line') {
      x = Math.min(el.x1, el.x2);
      y = Math.min(el.y1, el.y2);
      w = Math.abs(el.x1 - el.x2);
      h = Math.abs(el.y1 - el.y2);
    } else if (el.type === 'text') {
      ctx.font = `${el.fontSize}px Inter`;
      const metrics = ctx.measureText(el.text);
      x = el.x;
      y = el.y;
      w = metrics.width;
      h = el.fontSize + 4;
    } else if (el.type === 'pencil') {
      // Find bounding box for pencil points
      const xs = el.points.map(p => p.x);
      const ys = el.points.map(p => p.y);
      x = Math.min(...xs);
      y = Math.min(...ys);
      w = Math.max(...xs) - x;
      h = Math.max(...ys) - y;
    }

    ctx.strokeRect(x - 6, y - 6, w + 12, h + 12);

    // Draw drag resize handle indicators
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#3b82f6';
    ctx.setLineDash([]);
    ctx.lineWidth = 1.5;

    const handles = [
      { x: x - 6, y: y - 6 },
      { x: x + w + 6, y: y - 6 },
      { x: x - 6, y: y + h + 6 },
      { x: x + w + 6, y: y + h + 6 }
    ];

    handles.forEach((h) => {
      ctx.beginPath();
      ctx.rect(h.x - 4, h.y - 4, 8, 8);
      ctx.fill();
      ctx.stroke();
    });

    ctx.restore();
  };

  const drawLaserPath = (ctx: CanvasRenderingContext2D, path: Point[], color: string) => {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;

    ctx.beginPath();
    ctx.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) {
      ctx.lineTo(path[i].x, path[i].y);
    }
    ctx.stroke();
    ctx.restore();
  };

  const drawRemoteCursor = (ctx: CanvasRenderingContext2D, cur: CursorPresence) => {
    ctx.save();
    ctx.fillStyle = cur.userColor;
    
    // Draw pointer cursor icon
    ctx.beginPath();
    ctx.moveTo(cur.x, cur.y);
    ctx.lineTo(cur.x + 12, cur.y + 12);
    ctx.lineTo(cur.x + 4, cur.y + 14);
    ctx.closePath();
    ctx.fill();

    // Draw custom name pill
    ctx.font = 'bold 10px Inter';
    const textWidth = ctx.measureText(cur.userName).width;
    
    ctx.fillStyle = cur.userColor;
    ctx.beginPath();
    ctx.roundRect?.(cur.x + 10, cur.y + 15, textWidth + 12, 18, 4);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.fillText(cur.userName, cur.x + 16, cur.y + 28);
    ctx.restore();
  };

  // 6. Action: Selecting Element Check
  const getElementAtPosition = (point: Point): BoardElement | null => {
    // Traverse elements backwards to click top elements first
    for (let i = elements.length - 1; i >= 0; i--) {
      const el = elements[i];
      if ((el.page || 0) !== currentPage) continue;

      if (el.type === 'rectangle' || el.type === 'sticky') {
        const minX = el.x;
        const maxX = el.x + el.width;
        const minY = el.y;
        const maxY = el.y + el.height;
        if (point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY) {
          return el;
        }
      } else if (el.type === 'circle') {
        const dx = point.x - el.cx;
        const dy = point.y - el.cy;
        const rx = Math.abs(el.rx);
        const ry = Math.abs(el.ry);
        if ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1) {
          return el;
        }
      } else if (el.type === 'text') {
        // Measure text bounds approximately
        const width = el.text.length * (el.fontSize * 0.6);
        if (point.x >= el.x && point.x <= el.x + width && point.y >= el.y && point.y <= el.y + el.fontSize) {
          return el;
        }
      } else if (el.type === 'line') {
        // Distance to line segment
        const A = point.x - el.x1;
        const B = point.y - el.y1;
        const C = el.x2 - el.x1;
        const D = el.y2 - el.y1;
        const dot = A * C + B * D;
        const lenSq = C * C + D * D;
        let param = -1;
        if (lenSq !== 0) param = dot / lenSq;
        
        let xx, yy;
        if (param < 0) {
          xx = el.x1;
          yy = el.y1;
        } else if (param > 1) {
          xx = el.x2;
          yy = el.y2;
        } else {
          xx = el.x1 + param * C;
          yy = el.y1 + param * D;
        }
        
        const dx = point.x - xx;
        const dy = point.y - yy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 8) return el;
      } else if (el.type === 'pencil') {
        // Check if cursor is near any point in pencil
        for (let j = 0; j < el.points.length; j++) {
          const dx = point.x - el.points[j].x;
          const dy = point.y - el.points[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 8) return el;
        }
      }
    }
    return null;
  };

  const getResizeHandleAtPosition = (point: Point): 'nw' | 'ne' | 'sw' | 'se' | null => {
    if (!selectedElementId) return null;
    const el = elements.find(e => e.id === selectedElementId);
    if (!el) return null;

    let x = 0, y = 0, w = 0, h = 0;

    if (el.type === 'rectangle' || el.type === 'sticky') {
      x = el.x;
      y = el.y;
      w = el.width;
      h = el.height;
    } else if (el.type === 'circle') {
      x = el.cx - Math.abs(el.rx);
      y = el.cy - Math.abs(el.ry);
      w = Math.abs(el.rx) * 2;
      h = Math.abs(el.ry) * 2;
    } else if (el.type === 'line') {
      x = Math.min(el.x1, el.x2);
      y = Math.min(el.y1, el.y2);
      w = Math.abs(el.x1 - el.x2);
      h = Math.abs(el.y1 - el.y2);
    } else if (el.type === 'text') {
      const textWidth = el.text.length * (el.fontSize * 0.6);
      x = el.x;
      y = el.y;
      w = textWidth;
      h = el.fontSize + 4;
    } else if (el.type === 'pencil') {
      const xs = el.points.map(p => p.x);
      const ys = el.points.map(p => p.y);
      x = Math.min(...xs);
      y = Math.min(...ys);
      w = Math.max(...xs) - x;
      h = Math.max(...ys) - y;
    }

    const handles = [
      { id: 'nw', x: x - 6, y: y - 6 },
      { id: 'ne', x: x + w + 6, y: y - 6 },
      { id: 'sw', x: x - 6, y: y + h + 6 },
      { id: 'se', x: x + w + 6, y: y + h + 6 }
    ] as const;

    for (const h of handles) {
      const dx = point.x - h.x;
      const dy = point.y - h.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 10) {
        return h.id;
      }
    }

    return null;
  };

  // Pointer event handlers
  const handlePointerDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const worldPoint = getCanvasCoords(e);
    syncCursorPosition(worldPoint);

    // Viewers can only pan
    if (currentUserRole === 'viewer') {
      setIsPanning(true);
      panStart.current = { x: e.clientX, y: e.clientY };
      return;
    }

    // Pan with Hand tool active, Spacebar held, or middle/right click
    const isPanToolActive = activeTool === 'hand' || (isSpacePressed && !isInputActive());
    if (isPanToolActive || e.button === 1 || e.button === 2) {
      setIsPanning(true);
      panStart.current = { x: e.clientX, y: e.clientY };
      return;
    }

    if (activeTool === 'select') {
      const resizeHandle = getResizeHandleAtPosition(worldPoint);
      if (resizeHandle) {
        setActiveResizeHandle(resizeHandle);
        return;
      }

      const el = getElementAtPosition(worldPoint);
      if (el) {
        setSelectedElementId(el.id);
        setIsDraggingElement(true);
        // Track displacement
        if (el.type === 'rectangle' || el.type === 'sticky' || el.type === 'text') {
          dragOffset.current = { x: worldPoint.x - el.x, y: worldPoint.y - el.y };
        } else if (el.type === 'circle') {
          dragOffset.current = { x: worldPoint.x - el.cx, y: worldPoint.y - el.cy };
        } else if (el.type === 'line') {
          dragOffset.current = { x: worldPoint.x - el.x1, y: worldPoint.y - el.y1 };
        } else if (el.type === 'pencil') {
          dragOffset.current = { x: worldPoint.x, y: worldPoint.y };
        }
      } else {
        setSelectedElementId(null);
      }
      return;
    }

    if (activeTool === 'eraser') {
      const clicked = getElementAtPosition(worldPoint);
      if (clicked) {
        // Record mutation to undo stack before deleting
        setUndoStack((prev) => [...prev, { action: 'delete', element: clicked }]);
        deleteDoc(doc(db, 'boards', boardId, 'elements', clicked.id));
      }
      return;
    }

    // Standard drawing trigger
    isDrawing.current = true;
    drawingStart.current = worldPoint;

    if (activeTool === 'pencil') {
      setPencilPoints([worldPoint]);
      setLocalTempElement({
        type: 'pencil',
        points: [worldPoint],
        color: strokeColor,
        strokeWidth: strokeWidth,
        opacity: opacity,
        createdAt: Date.now(),
        updatedBy: user?.uid || 'anonymous',
        userName: userName || 'User',
        page: currentPage
      });
    } else if (activeTool === 'laser') {
      setLaserPath([worldPoint]);
      if (laserTimer.current) clearTimeout(laserTimer.current);
    } else if (activeTool === 'text') {
      // Inline spawn text edit overlay
      setEditingTextElement({
        id: 'new_text',
        type: 'text',
        x: worldPoint.x,
        y: worldPoint.y,
        text: ''
      });
      isDrawing.current = false;
    } else if (activeTool === 'sticky') {
      // Create sticky note right away
      setEditingTextElement({
        id: 'new_sticky',
        type: 'sticky',
        x: worldPoint.x,
        y: worldPoint.y,
        text: '',
        bgColor: fillColor !== 'transparent' ? fillColor : '#fef08a'
      });
      isDrawing.current = false;
    }
  };

  const handlePointerMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const worldPoint = getCanvasCoords(e);
    syncCursorPosition(worldPoint, activeTool === 'laser');

    if (isPanning) {
      const dx = e.clientX - panStart.current.x;
      const dy = e.clientY - panStart.current.y;
      setPan({ x: pan.x + dx, y: pan.y + dy });
      panStart.current = { x: e.clientX, y: e.clientY };
      return;
    }

    if (activeTool === 'select') {
      const handleHover = getResizeHandleAtPosition(worldPoint);
      if (handleHover) {
        if (handleHover === 'nw' || handleHover === 'se') {
          setCanvasCursor('nwse-resize');
        } else {
          setCanvasCursor('nesw-resize');
        }
      } else {
        const hoveredElement = getElementAtPosition(worldPoint);
        if (hoveredElement) {
          setCanvasCursor('move');
        } else {
          setCanvasCursor('default');
        }
      }
    }

    if (activeResizeHandle && selectedElementId && activeTool === 'select' && currentUserRole !== 'viewer') {
      const el = elements.find(item => item.id === selectedElementId);
      if (!el) return;

      let curX = 0, curY = 0, curW = 0, curH = 0;
      if (el.type === 'rectangle' || el.type === 'sticky') {
        curX = el.x;
        curY = el.y;
        curW = el.width;
        curH = el.height;
      } else if (el.type === 'circle') {
        curX = el.cx - Math.abs(el.rx);
        curY = el.cy - Math.abs(el.ry);
        curW = Math.abs(el.rx) * 2;
        curH = Math.abs(el.ry) * 2;
      } else if (el.type === 'line') {
        curX = Math.min(el.x1, el.x2);
        curY = Math.min(el.y1, el.y2);
        curW = Math.abs(el.x1 - el.x2) || 1;
        curH = Math.abs(el.y1 - el.y2) || 1;
      } else if (el.type === 'text') {
        const textWidth = el.text.length * (el.fontSize * 0.6);
        curX = el.x;
        curY = el.y;
        curW = textWidth || 10;
        curH = el.fontSize + 4;
      } else if (el.type === 'pencil') {
        const xs = el.points.map(p => p.x);
        const ys = el.points.map(p => p.y);
        curX = Math.min(...xs);
        curY = Math.min(...ys);
        curW = (Math.max(...xs) - curX) || 1;
        curH = (Math.max(...ys) - curY) || 1;
      }

      const rightX = curX + curW;
      const bottomY = curY + curH;
      const minSize = 10;

      let newX = curX, newY = curY, newW = curW, newH = curH;

      if (activeResizeHandle === 'nw') {
        newW = Math.max(minSize, rightX - worldPoint.x);
        newH = Math.max(minSize, bottomY - worldPoint.y);
        newX = rightX - newW;
        newY = bottomY - newH;
      } else if (activeResizeHandle === 'ne') {
        newW = Math.max(minSize, worldPoint.x - curX);
        newH = Math.max(minSize, bottomY - worldPoint.y);
        newX = curX;
        newY = bottomY - newH;
      } else if (activeResizeHandle === 'sw') {
        newW = Math.max(minSize, rightX - worldPoint.x);
        newH = Math.max(minSize, worldPoint.y - curY);
        newX = rightX - newW;
        newY = curY;
      } else if (activeResizeHandle === 'se') {
        newW = Math.max(minSize, worldPoint.x - curX);
        newH = Math.max(minSize, worldPoint.y - curY);
        newX = curX;
        newY = curY;
      }

      const updatedData: any = {};
      if (el.type === 'rectangle' || el.type === 'sticky') {
        updatedData.x = newX;
        updatedData.y = newY;
        updatedData.width = newW;
        updatedData.height = newH;
      } else if (el.type === 'circle') {
        updatedData.cx = newX + newW / 2;
        updatedData.cy = newY + newH / 2;
        updatedData.rx = newW / 2;
        updatedData.ry = newH / 2;
      } else if (el.type === 'line') {
        const scaleX = (x: number) => newX + ((x - curX) / curW) * newW;
        const scaleY = (y: number) => newY + ((y - curY) / curH) * newH;
        updatedData.x1 = scaleX(el.x1);
        updatedData.y1 = scaleY(el.y1);
        updatedData.x2 = scaleX(el.x2);
        updatedData.y2 = scaleY(el.y2);
      } else if (el.type === 'pencil') {
        const scaleX = (x: number) => newX + ((x - curX) / curW) * newW;
        const scaleY = (y: number) => newY + ((y - curY) / curH) * newH;
        updatedData.points = el.points.map(p => ({
          x: scaleX(p.x),
          y: scaleY(p.y)
        }));
      } else if (el.type === 'text') {
        const scale = newW / curW;
        updatedData.fontSize = Math.max(8, Math.round(el.fontSize * scale));
        updatedData.x = newX;
        updatedData.y = newY;
      }

      setElements(prev => prev.map(item => item.id === selectedElementId ? { ...item, ...updatedData } : item));
      updateDoc(doc(db, 'boards', boardId, 'elements', selectedElementId), updatedData);
      return;
    }

    if (isDraggingElement && selectedElementId && activeTool === 'select' && currentUserRole !== 'viewer') {
      const original = elements.find(el => el.id === selectedElementId);
      if (!original) return;

      const updatedData: any = {};
      const dx = worldPoint.x - (original.type === 'pencil' ? dragOffset.current.x : dragOffset.current.x);
      const dy = worldPoint.y - (original.type === 'pencil' ? dragOffset.current.y : dragOffset.current.y);

      if (original.type === 'rectangle' || original.type === 'sticky' || original.type === 'text') {
        updatedData.x = worldPoint.x - dragOffset.current.x;
        updatedData.y = worldPoint.y - dragOffset.current.y;
      } else if (original.type === 'circle') {
        updatedData.cx = worldPoint.x - dragOffset.current.x;
        updatedData.cy = worldPoint.y - dragOffset.current.y;
      } else if (original.type === 'line') {
        const dxLine = worldPoint.x - dragOffset.current.x - original.x1;
        const dyLine = worldPoint.y - dragOffset.current.y - original.y1;
        updatedData.x1 = original.x1 + dxLine;
        updatedData.y1 = original.y1 + dyLine;
        updatedData.x2 = original.x2 + dxLine;
        updatedData.y2 = original.y2 + dyLine;
      } else if (original.type === 'pencil') {
        const dxPen = worldPoint.x - dragOffset.current.x;
        const dyPen = worldPoint.y - dragOffset.current.y;
        updatedData.points = original.points.map(p => ({ x: p.x + dxPen, y: p.y + dyPen }));
        dragOffset.current = { x: worldPoint.x, y: worldPoint.y }; // update offset
      }

      // Update locally immediately for instant feedback
      setElements(prev => prev.map(el => el.id === selectedElementId ? { ...el, ...updatedData } : el));
      
      // Update in Firestore
      updateDoc(doc(db, 'boards', boardId, 'elements', selectedElementId), updatedData);
      return;
    }

    if (!isDrawing.current) return;

    if (activeTool === 'pencil') {
      const pts = [...pencilPoints, worldPoint];
      setPencilPoints(pts);
      setLocalTempElement((prev: any) => ({
        ...prev,
        points: pts
      }));
    } else if (activeTool === 'laser') {
      const pts = [...laserPath, worldPoint];
      setLaserPath(pts);
    } else if (activeTool === 'line') {
      setLocalTempElement({
        type: 'line',
        x1: drawingStart.current.x,
        y1: drawingStart.current.y,
        x2: worldPoint.x,
        y2: worldPoint.y,
        color: strokeColor,
        strokeWidth: strokeWidth,
        opacity: opacity,
        createdAt: Date.now(),
        updatedBy: user?.uid || 'anonymous',
        userName: userName || 'User',
        page: currentPage
      });
    } else if (activeTool === 'rectangle') {
      const x = Math.min(drawingStart.current.x, worldPoint.x);
      const y = Math.min(drawingStart.current.y, worldPoint.y);
      const width = Math.abs(drawingStart.current.x - worldPoint.x);
      const height = Math.abs(drawingStart.current.y - worldPoint.y);
      setLocalTempElement({
        type: 'rectangle',
        x,
        y,
        width,
        height,
        fillColor: fillColor,
        color: strokeColor,
        strokeWidth: strokeWidth,
        opacity: opacity,
        createdAt: Date.now(),
        updatedBy: user?.uid || 'anonymous',
        userName: userName || 'User',
        page: currentPage
      });
    } else if (activeTool === 'circle') {
      const cx = drawingStart.current.x;
      const cy = drawingStart.current.y;
      const rx = worldPoint.x - cx;
      const ry = worldPoint.y - cy;
      setLocalTempElement({
        type: 'circle',
        cx,
        cy,
        rx,
        ry,
        fillColor: fillColor,
        color: strokeColor,
        strokeWidth: strokeWidth,
        opacity: opacity,
        createdAt: Date.now(),
        updatedBy: user?.uid || 'anonymous',
        userName: userName || 'User',
        page: currentPage
      });
    }
  };

  const handlePointerUp = async () => {
    isDrawing.current = false;
    setIsPanning(false);
    setIsDraggingElement(false);
    setActiveResizeHandle(null);
    setCanvasCursor('default');

    if (activeTool === 'laser' && laserPath.length > 0) {
      // Fade laser path out after 1.5 seconds
      laserTimer.current = setTimeout(() => {
        setLaserPath([]);
        // Sync clear self laser presence
        if (user) {
          updateDoc(doc(db, 'boards', boardId, 'cursors', user.uid), {
            laserPoints: []
          });
        }
      }, 1000);
      return;
    }

    if (localTempElement) {
      try {
        // Save to Firestore elements
        const docRef = await addDoc(collection(db, 'boards', boardId, 'elements'), localTempElement);
        
        // Push to undo stack
        setUndoStack(prev => [...prev, { action: 'create', id: docRef.id, element: localTempElement }]);
        setRedoStack([]); // Clear redo
      } catch (err) {
        console.error("Error creating element", err);
      } finally {
        setLocalTempElement(null);
        setPencilPoints([]);
      }
    }
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      const isPanToolActive = activeTool === 'hand' || (isSpacePressed && !isInputActive());
      
      if (isPanToolActive) {
        setIsPanning(true);
        panStart.current = { x: touch.clientX, y: touch.clientY };
      } else {
        const fakeEvent = {
          button: 0,
          clientX: touch.clientX,
          clientY: touch.clientY,
          preventDefault: () => {},
          stopPropagation: () => {}
        } as unknown as React.MouseEvent<HTMLCanvasElement>;
        handlePointerDown(fakeEvent);
      }
    } else if (e.touches.length === 2) {
      isDrawing.current = false;
      setIsPanning(false);
      setLocalTempElement(null);
      
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const dist = getTouchDist(t1, t2);
      const midpoint = getTouchMidpoint(t1, t2);
      
      touchStartDist.current = dist;
      touchStartZoom.current = zoom;
      touchStartPan.current = pan;
      touchStartMidpoint.current = midpoint;
      isPinchZooming.current = true;
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (isPinchZooming.current && e.touches.length === 2) {
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const dist = getTouchDist(t1, t2);
      const midpoint = getTouchMidpoint(t1, t2);
      
      if (touchStartDist.current !== null) {
        const scale = dist / touchStartDist.current;
        const newZoom = Math.max(0.1, Math.min(5, touchStartZoom.current * scale));
        
        const dx = midpoint.x - touchStartMidpoint.current.x;
        const dy = midpoint.y - touchStartMidpoint.current.y;
        
        if (canvasRef.current) {
          const rect = canvasRef.current.getBoundingClientRect();
          const focusX = touchStartMidpoint.current.x - rect.left;
          const focusY = touchStartMidpoint.current.y - rect.top;
          
          const zoomFactor = newZoom / touchStartZoom.current;
          
          setPan({
            x: focusX - (focusX - touchStartPan.current.x) * zoomFactor + dx,
            y: focusY - (focusY - touchStartPan.current.y) * zoomFactor + dy
          });
          setZoom(newZoom);
        }
      }
      if (e.cancelable) e.preventDefault();
    } else if (e.touches.length === 1) {
      const touch = e.touches[0];
      if (isPanning) {
        const dx = touch.clientX - panStart.current.x;
        const dy = touch.clientY - panStart.current.y;
        setPan(prev => ({ x: prev.x + dx, y: prev.y + dy }));
        panStart.current = { x: touch.clientX, y: touch.clientY };
      } else {
        const fakeEvent = {
          clientX: touch.clientX,
          clientY: touch.clientY,
          preventDefault: () => {},
          stopPropagation: () => {}
        } as unknown as React.MouseEvent<HTMLCanvasElement>;
        handlePointerMove(fakeEvent);
      }
    }
  };

  const handleTouchEnd = () => {
    if (isPinchZooming.current) {
      isPinchZooming.current = false;
      touchStartDist.current = null;
    } else {
      handlePointerUp();
    }
  };

  const getTouchDist = (t1: React.Touch, t2: React.Touch) => {
    const dx = t1.clientX - t2.clientX;
    const dy = t1.clientY - t2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const getTouchMidpoint = (t1: React.Touch, t2: React.Touch) => {
    return {
      x: (t1.clientX + t2.clientX) / 2,
      y: (t1.clientY + t2.clientY) / 2
    };
  };

  // Undo and Redo actions
  const handleUndo = async () => {
    if (undoStack.length === 0) return;
    const last = undoStack[undoStack.length - 1];
    setUndoStack(prev => prev.slice(0, -1));

    if (last.action === 'create') {
      try {
        // Store in redo stack
        setRedoStack(prev => [...prev, { action: 'delete', id: last.id, element: last.element }]);
        await deleteDoc(doc(db, 'boards', boardId, 'elements', last.id));
      } catch (e) {
        console.error(e);
      }
    } else if (last.action === 'delete') {
      try {
        const docRef = await addDoc(collection(db, 'boards', boardId, 'elements'), last.element);
        setRedoStack(prev => [...prev, { action: 'create', id: docRef.id, element: last.element }]);
      } catch (e) {
        console.error(e);
      }
    }
  };

  const handleRedo = async () => {
    if (redoStack.length === 0) return;
    const last = redoStack[redoStack.length - 1];
    setRedoStack(prev => prev.slice(0, -1));

    if (last.action === 'delete') {
      try {
        setUndoStack(prev => [...prev, { action: 'create', id: last.id, element: last.element }]);
        await deleteDoc(doc(db, 'boards', boardId, 'elements', last.id));
      } catch (e) {
        console.error(e);
      }
    } else if (last.action === 'create') {
      try {
        const docRef = await addDoc(collection(db, 'boards', boardId, 'elements'), last.element);
        setUndoStack(prev => [...prev, { action: 'delete', id: docRef.id, element: last.element }]);
      } catch (e) {
        console.error(e);
      }
    }
  };

  // Delete key press to remove selected element
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (selectedElementId && activeTool === 'select' && (e.key === 'Delete' || e.key === 'Backspace')) {
        // Prevent typing deletions in Text Overlay inputs
        if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') {
          return;
        }
        const deleting = elements.find(el => el.id === selectedElementId);
        if (deleting) {
          setUndoStack(prev => [...prev, { action: 'delete', id: selectedElementId, element: deleting }]);
          deleteDoc(doc(db, 'boards', boardId, 'elements', selectedElementId));
          setSelectedElementId(null);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedElementId, elements]);

  // Double click to edit sticky or text element
  const handleCanvasDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (currentUserRole === 'viewer') return;
    const worldPoint = getCanvasCoords(e);
    const clicked = getElementAtPosition(worldPoint);
    if (clicked && (clicked.type === 'sticky' || clicked.type === 'text')) {
      setEditingTextElement({
        id: clicked.id,
        type: clicked.type,
        x: clicked.type === 'sticky' ? clicked.x : clicked.x,
        y: clicked.type === 'sticky' ? clicked.y : clicked.y,
        text: clicked.text,
        bgColor: clicked.type === 'sticky' ? (clicked as StickyElement).bgColor : undefined
      });
    }
  };

  // Save editable text / sticky overlay changes
  const saveTextOverlayEdit = async () => {
    if (!editingTextElement) return;

    const trimmedText = editingTextElement.text.trim();
    if (!trimmedText) {
      // If empty and was newly spawned, just cancel
      if (editingTextElement.id.startsWith('new_')) {
        setEditingTextElement(null);
        return;
      }
      // If empty existing, delete it
      await deleteDoc(doc(db, 'boards', boardId, 'elements', editingTextElement.id));
      setEditingTextElement(null);
      return;
    }

    if (editingTextElement.id === 'new_text') {
      const data = {
        type: 'text',
        x: editingTextElement.x,
        y: editingTextElement.y,
        text: trimmedText,
        color: strokeColor,
        strokeWidth: strokeWidth,
        opacity: opacity,
        fontSize: strokeWidth * 4 || 16,
        fontFamily: fontFamily,
        createdAt: Date.now(),
        updatedBy: user?.uid || 'anonymous',
        userName: userName || 'User',
        page: currentPage
      };
      await addDoc(collection(db, 'boards', boardId, 'elements'), data);
    } else if (editingTextElement.id === 'new_sticky') {
      const colors = ['#fef08a', '#bfdbfe', '#fbcfe8', '#bbf7d0', '#fed7aa'];
      const data = {
        type: 'sticky',
        x: editingTextElement.x,
        y: editingTextElement.y,
        width: 180,
        height: 180,
        text: trimmedText,
        bgColor: editingTextElement.bgColor || (fillColor !== 'transparent' ? fillColor : colors[Math.floor(Math.random() * colors.length)]),
        color: '#1e293b',
        strokeWidth: 1,
        opacity: 1,
        createdAt: Date.now(),
        updatedBy: user?.uid || 'anonymous',
        userName: userName || 'User',
        page: currentPage
      };
      await addDoc(collection(db, 'boards', boardId, 'elements'), data);
    } else {
      // Edit existing
      await updateDoc(doc(db, 'boards', boardId, 'elements', editingTextElement.id), {
        text: trimmedText,
        updatedBy: user?.uid || 'anonymous',
        updatedAt: Date.now()
      });
    }

    setEditingTextElement(null);
  };

  // Clear Board Canvas completely
  const handleClearCanvas = async () => {
    if (!confirm("Are you sure you want to clear this entire whiteboard page? This cannot be undone.")) {
      return;
    }
    try {
      const pageElements = elements.filter(el => (el.page || 0) === currentPage);
      for (const el of pageElements) {
        await deleteDoc(doc(db, 'boards', boardId, 'elements', el.id));
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Export board functions
  const triggerExport = async (format: 'png' | 'jpeg' | 'pdf') => {
    const container = containerRef.current;
    if (!container) return;

    try {
      const canvas = await html2canvas(container, {
        useCORS: true,
        allowTaint: true,
        backgroundColor: isDarkTheme ? '#020617' : '#ffffff',
        scale: 2 // Crisp HD quality
      });

      if (format === 'png' || format === 'jpeg') {
        const url = canvas.toDataURL(`image/${format}`, 1.0);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${board?.title || 'Whiteboard'}.${format}`;
        link.click();
      } else if (format === 'pdf') {
        const orientation = canvas.width > canvas.height ? 'landscape' : 'portrait';
        const pdf = new jsPDF(orientation, 'px', [canvas.width / 2, canvas.height / 2]);
        const imgData = canvas.toDataURL('image/png');
        pdf.addImage(imgData, 'PNG', 0, 0, canvas.width / 2, canvas.height / 2);
        pdf.save(`${board?.title || 'Whiteboard'}.pdf`);
      }
    } catch (err) {
      console.error("html2canvas export failed, falling back to manual canvas render", err);
      const canvas = canvasRef.current;
      if (!canvas) return;

      const exportCanvas = document.createElement('canvas');
      exportCanvas.width = canvas.width;
      exportCanvas.height = canvas.height;
      const ctx = exportCanvas.getContext('2d');
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      ctx.scale(dpr, dpr);

      ctx.fillStyle = isDarkTheme ? '#0b1329' : '#f8f9ff';
      ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);

      ctx.save();
      ctx.translate(pan.x, pan.y);
      ctx.scale(zoom, zoom);

      elements.filter(el => (el.page || 0) === currentPage).forEach((el) => {
        drawElement(ctx, el);
      });

      ctx.restore();

      if (format === 'png' || format === 'jpeg') {
        const url = exportCanvas.toDataURL(`image/${format}`, 1.0);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${board?.title || 'Whiteboard'}.${format}`;
        link.click();
      } else if (format === 'pdf') {
        const pdf = new jsPDF('landscape', 'px', [exportCanvas.width / dpr, exportCanvas.height / dpr]);
        const imgData = exportCanvas.toDataURL('image/png');
        pdf.addImage(imgData, 'PNG', 0, 0, exportCanvas.width / dpr, exportCanvas.height / dpr);
        pdf.save(`${board?.title || 'Whiteboard'}.pdf`);
      }
    }
  };

  // Chat message send
  const handleSendChatMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !user) return;

    try {
      await addDoc(collection(db, 'boards', boardId, 'messages'), {
        userId: user.uid,
        userName: userName || 'Anonymous',
        userColor: userColor || '#ef4444',
        text: chatInput.trim(),
        createdAt: Date.now()
      });
      setChatInput('');
    } catch (err) {
      console.error(err);
    }
  };

  // Page management
  const handleNextPage = async () => {
    const next = currentPage + 1;
    setCurrentPage(next);
    // Update in board
    await updateDoc(doc(db, 'boards', boardId), {
      currentPage: next,
      pagesCount: Math.max(board?.pagesCount || 1, next + 1)
    });
  };

  const handlePrevPage = async () => {
    if (currentPage === 0) return;
    const prev = currentPage - 1;
    setCurrentPage(prev);
    await updateDoc(doc(db, 'boards', boardId), {
      currentPage: prev
    });
  };

  // Invite Copy Share Link
  const handleCopyInviteLink = () => {
    const url = `${window.location.origin}/board/${boardId}`;
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  // Add workspace contributor email
  const handleAddCollaborator = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    const emailToAdd = inviteEmail.trim().toLowerCase();
    
    if (!emailToAdd.includes('@')) {
      setInviteError('Please enter a valid email address.');
      return;
    }

    if (!board) return;
    const currentCollaborators = board.collaborators || [];
    if (currentCollaborators.includes(emailToAdd)) {
      setInviteError('This email is already invited.');
      return;
    }

    try {
      setInviteError('');
      const updatedCollaborators = [...currentCollaborators, emailToAdd];
      const updatedPermissions = { ...(board.permissions || {}) };
      updatedPermissions[emailToAdd] = 'editor'; // Default role is Editor

      await updateDoc(doc(db, 'boards', boardId), {
        collaborators: updatedCollaborators,
        permissions: updatedPermissions
      });
      setInviteEmail('');
    } catch (err: any) {
      setInviteError('Failed to invite collaborator.');
    }
  };

  // Remove workspace contributor email
  const handleRemoveCollaborator = async (emailToRemove: string) => {
    if (!board) return;
    try {
      const currentCollaborators = board.collaborators || [];
      const updatedCollaborators = currentCollaborators.filter(email => email !== emailToRemove);
      const updatedPermissions = { ...(board.permissions || {}) };
      delete updatedPermissions[emailToRemove];

      await updateDoc(doc(db, 'boards', boardId), {
        collaborators: updatedCollaborators,
        permissions: updatedPermissions
      });
    } catch (err) {
      console.error('Failed to remove collaborator', err);
    }
  };

  // Validate private board access
  const hasAccess = !board || !board.isPrivate || board.ownerId === user?.uid || (board.collaborators && (board.collaborators.includes(user?.email?.toLowerCase() || '') || board.collaborators.includes(user?.uid || '')));

  // Pre-configured custom color palettes
  const COLORS = [
    '#3b82f6', // Bright Blue
    '#10b981', // Emerald Green
    '#f59e0b', // Yellow Amber
    '#ef4444', // Red
    '#ec4899', // Pink
    '#8b5cf6', // Violet
    '#06b6d4', // Cyan
    '#ffffff', // White
    '#000000'  // Black
  ];

  const STICKY_COLORS = [
    '#fef08a', // Light Yellow
    '#bfdbfe', // Light Blue
    '#fbcfe8', // Light Pink
    '#bbf7d0', // Light Green
    '#fed7aa'  // Light Orange
  ];

  if (board && !hasAccess) {
    return (
      <div className={`min-h-screen flex flex-col items-center justify-center gap-6 font-sans px-4 text-center transition-colors duration-300 ${isDarkTheme ? 'bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-800'}`}>
        <div className="w-16 h-16 bg-rose-500/10 border border-rose-500/20 rounded-2xl flex items-center justify-center text-rose-500 shadow-lg">
          <Lock className="w-8 h-8" />
        </div>
        <div className="max-w-md space-y-2">
          <h2 className="text-xl font-display font-extrabold tracking-tight">Private Whiteboard</h2>
          <p className={`text-sm ${isDarkTheme ? 'text-slate-400' : 'text-slate-500'} leading-relaxed`}>
            This board has been set to private. Only the creator and explicitly invited collaborators are permitted to view or edit this workspace.
          </p>
        </div>
        <button
          onClick={onBackToDashboard}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2.5 rounded-xl text-xs font-bold shadow-lg transition-all active:scale-95 duration-150 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Dashboard</span>
        </button>
      </div>
    );
  }

  return (
    <div className={`flex-1 h-screen flex flex-col relative overflow-hidden select-none font-sans transition-colors duration-300 ${isDarkTheme ? 'bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-800'}`}>
      
      {/* Background Ambient Glows */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-indigo-600/5 rounded-full blur-[100px] pointer-events-none"></div>
      <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-cyan-600/5 rounded-full blur-[100px] pointer-events-none"></div>

      {/* Top Header Panel (Matches Drawing Screen mockup) */}
      <header className={`h-16 border-b px-6 flex items-center justify-between shrink-0 z-20 shadow-xl backdrop-blur-xl transition-colors duration-300 ${
        isDarkTheme ? 'bg-slate-900/80 border-slate-900/60' : 'bg-white/80 border-slate-200/60'
      }`}>
        <div className="flex items-center gap-4">
          <button 
            onClick={onBackToDashboard}
            className={`w-10 h-10 rounded-xl transition-all flex items-center justify-center border cursor-pointer ${
              isDarkTheme 
                ? 'hover:bg-slate-800 border-slate-800 text-slate-400 hover:text-slate-200' 
                : 'hover:bg-slate-100 border-slate-200 text-slate-600 hover:text-slate-900'
            }`}
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex flex-col">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-[10px] font-bold tracking-widest uppercase ${isDarkTheme ? 'text-indigo-400' : 'text-indigo-600'}`}>
                Workspace Board
              </span>
              {board?.isPrivate ? (
                <span className="bg-purple-500/10 text-purple-400 text-[9px] px-2 py-0.5 rounded-full font-bold border border-purple-500/20 flex items-center gap-1 shrink-0">
                  <Lock className="w-2.5 h-2.5" />
                  <span>Private</span>
                </span>
              ) : (
                <span className="bg-indigo-500/10 text-indigo-400 text-[9px] px-2 py-0.5 rounded-full font-bold border border-indigo-500/20 flex items-center gap-1 shrink-0">
                  <Globe className="w-2.5 h-2.5" />
                  <span>Public Editor</span>
                </span>
              )}
              {currentUserRole === 'owner' && (
                <span className="bg-amber-500/10 text-amber-500 text-[9px] px-2 py-0.5 rounded-full font-bold border border-amber-500/20 shrink-0">
                  Owner
                </span>
              )}
              {currentUserRole === 'editor' && (
                <span className="bg-emerald-500/10 text-emerald-400 text-[9px] px-2 py-0.5 rounded-full font-bold border border-emerald-500/20 shrink-0">
                  Editor
                </span>
              )}
              {currentUserRole === 'viewer' && (
                <span className="bg-slate-500/15 text-slate-400 text-[9px] px-2 py-0.5 rounded-full font-bold border border-slate-500/20 shrink-0 flex items-center gap-1">
                  <Eye className="w-2.5 h-2.5" />
                  <span>Viewer Mode</span>
                </span>
              )}
              {authWarning && (
                <span className="bg-amber-500/10 text-amber-500 text-[9px] px-2 py-0.5 rounded-full font-bold border border-amber-500/20 animate-pulse">
                  Sandbox Active
                </span>
              )}
            </div>
            <input
              type="text"
              readOnly={currentUserRole === 'viewer'}
              value={board?.title || ''}
              onChange={(e) => {
                if (board) {
                  updateDoc(doc(db, 'boards', boardId), { title: e.target.value });
                }
              }}
              className={`font-display font-bold text-base border-b border-transparent focus:border-indigo-500 bg-transparent outline-none transition-all duration-150 py-0.5 px-0.5 truncate max-w-xs md:max-w-sm ${
                isDarkTheme ? 'text-white' : 'text-slate-950'
              }`}
              placeholder="System Architecture Sketch"
            />
          </div>
        </div>

        {/* Cursors, Users list, Actions */}
        <div className="flex items-center gap-4">
          
          {/* Active Collaborators list matching '+2' aesthetic */}
          <div className="flex items-center -space-x-1.5">
            <div 
              className="w-8.5 h-8.5 rounded-xl flex items-center justify-center text-xs font-bold border-2 text-white shadow-lg transition-all"
              style={{ backgroundColor: userColor, borderColor: isDarkTheme ? '#0f172a' : '#ffffff' }}
              title={`You (${userName})`}
            >
              {userAvatar}
            </div>
            {(Object.values(activeUsers) as UserPresence[]).filter(u => u.userId !== user?.uid).slice(0, 2).map((collabUser) => {
              return (
                <div 
                  key={collabUser.userId}
                  className="w-8.5 h-8.5 rounded-xl flex items-center justify-center text-xs font-bold border-2 text-white shadow-lg transition-all"
                  style={{ backgroundColor: collabUser.userColor, borderColor: isDarkTheme ? '#0f172a' : '#ffffff' }}
                  title={collabUser.userName}
                >
                  {collabUser.userAvatar || collabUser.userName.slice(0, 2).toUpperCase()}
                </div>
              );
            })}
            {(Object.keys(activeUsers) as string[]).filter(uid => uid !== user?.uid).length > 2 && (
              <div className={`w-8.5 h-8.5 rounded-xl text-xs font-extrabold flex items-center justify-center border-2 shadow-lg ${
                isDarkTheme ? 'bg-slate-800 border-slate-950 text-slate-300' : 'bg-slate-100 border-white text-slate-600'
              }`}>
                +{(Object.keys(activeUsers) as string[]).filter(uid => uid !== user?.uid).length - 2}
              </div>
            )}
          </div>

          <div className={`h-6 w-[1px] ${isDarkTheme ? 'bg-slate-850' : 'bg-slate-200'}`}></div>

          {/* Share Board button */}
          <button
            onClick={() => setShowInviteModal(true)}
            className="flex items-center gap-1.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white px-4.5 py-2.5 rounded-xl text-xs font-bold shadow-lg shadow-indigo-950/20 transition-all cursor-pointer border border-indigo-400/20 active:scale-95 duration-150"
          >
            <Share2 className="w-3.5 h-3.5" />
            <span>Invite Teams</span>
          </button>

          {/* Dark / Light Mode Toggle */}
          <button
            onClick={toggleGlobalTheme}
            className={`w-9.5 h-9.5 rounded-xl border flex items-center justify-center transition-all cursor-pointer ${
              isDarkTheme 
                ? 'border-slate-800 bg-slate-800/40 hover:bg-slate-800 text-amber-400' 
                : 'border-slate-200 bg-slate-100 hover:bg-slate-200 text-slate-600'
            }`}
            title="Toggle Canvas Theme"
          >
            {isDarkTheme ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          {/* Export Options dropdown */}
          <div className="relative group">
            <button className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl border font-bold text-xs transition-all cursor-pointer ${
              isDarkTheme 
                ? 'border-slate-850 bg-slate-850/40 hover:bg-slate-850/90 text-slate-200' 
                : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
            }`}>
              <Download className="w-3.5 h-3.5" />
              <span>Export</span>
            </button>
            <div className={`absolute right-0 top-11 w-44 rounded-xl border shadow-2xl opacity-0 scale-95 pointer-events-none group-hover:opacity-100 group-hover:scale-100 group-hover:pointer-events-auto transition-all duration-200 z-30 ${
              isDarkTheme ? 'bg-slate-900 border-slate-800/80 text-slate-300' : 'bg-white border-slate-250 text-slate-700'
            }`}>
              <div className="p-1.5 space-y-0.5">
                <button 
                  onClick={() => triggerExport('png')}
                  className={`w-full text-left px-3 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${isDarkTheme ? 'hover:bg-slate-800/60 hover:text-white' : 'hover:bg-slate-100 hover:text-slate-950'}`}
                >
                  Export PNG Image
                </button>
                <button 
                  onClick={() => triggerExport('jpeg')}
                  className={`w-full text-left px-3 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${isDarkTheme ? 'hover:bg-slate-800/60 hover:text-white' : 'hover:bg-slate-100 hover:text-slate-950'}`}
                >
                  Export JPEG Format
                </button>
                <button 
                  onClick={() => triggerExport('pdf')}
                  className={`w-full text-left px-3 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${isDarkTheme ? 'hover:bg-slate-800/60 hover:text-white' : 'hover:bg-slate-100 hover:text-slate-950'}`}
                >
                  Export Vector PDF
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Drawing Body area */}
      <div className="flex-1 flex relative overflow-hidden">
        
        {/* Left Side Drawing Tool Toolbar panel */}
        <div className="fixed md:absolute bottom-3 md:bottom-auto left-1/2 md:left-6 md:top-1/2 -translate-x-1/2 md:translate-x-0 md:-translate-y-1/2 flex flex-row md:flex-col items-center gap-1 md:gap-1.5 p-1.5 md:p-2 rounded-2xl border shadow-2xl z-20 backdrop-blur-xl transition-all duration-350 pointer-events-auto max-w-[95vw] overflow-x-auto no-scrollbar"
             style={{ 
               backgroundColor: isDarkTheme ? 'rgba(15, 23, 42, 0.75)' : 'rgba(255, 255, 255, 0.85)',
               borderColor: isDarkTheme ? '#1e293b' : '#e2e8f0'
             }}>
          {[
            { id: 'select', label: 'Select', icon: MousePointer },
            { id: 'hand', label: 'Hand', icon: Hand },
            { id: 'pencil', label: 'Pencil', icon: Pencil },
            { id: 'rectangle', label: 'Square', icon: Square },
            { id: 'circle', label: 'Circle', icon: Circle },
            { id: 'line', label: 'Line', icon: Minus },
            { id: 'text', label: 'Text', icon: Type },
            { id: 'sticky', label: 'Sticky', icon: StickyNote },
            { id: 'eraser', label: 'Eraser', icon: Eraser },
            { id: 'laser', label: 'Laser', icon: Zap }
          ].map((tool) => {
            const Icon = tool.icon;
            const isActive = activeTool === tool.id;
            const isToolDisabled = currentUserRole === 'viewer' && tool.id !== 'select' && tool.id !== 'hand';
            return (
              <button
                key={tool.id}
                disabled={isToolDisabled}
                onClick={() => {
                  if (isToolDisabled) return;
                  setActiveTool(tool.id as ToolType);
                  if (tool.id !== 'select') setSelectedElementId(null);
                }}
                className={`w-10 h-10 md:w-11 md:h-11 shrink-0 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-all duration-150 ${
                  isToolDisabled 
                    ? 'opacity-25 cursor-not-allowed text-slate-500' 
                    : 'cursor-pointer hover:scale-[1.06] active:scale-[0.92]'
                } ${
                  isActive 
                    ? 'bg-indigo-600 text-white shadow-xl shadow-indigo-600/30 font-bold' 
                    : isDarkTheme 
                      ? 'text-slate-400 hover:bg-slate-800/80 hover:text-slate-100' 
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
                title={isToolDisabled ? `${tool.label} (Locked in Viewer mode)` : tool.label}
              >
                <Icon className="w-4.5 h-4.5" />
                <span className="text-[7px] md:text-[8px] font-bold leading-none tracking-tight uppercase">{tool.label}</span>
              </button>
            );
          })}
        </div>

        {/* Mobile Backdrop Overlay for Inspector Drawer */}
        {isInspectorOpenMobile && (
          <div 
            onClick={() => setIsInspectorOpenMobile(false)} 
            className="md:hidden fixed inset-0 bg-slate-950/60 backdrop-blur-xs z-30 animate-in fade-in duration-200"
          />
        )}

        {/* Floating properties panel overlay / Mobile slide-up drawer */}
        <div className={`fixed md:absolute bottom-0 md:bottom-auto left-0 md:left-24 md:top-6 right-0 md:right-auto w-full md:w-56 rounded-t-3xl md:rounded-2xl border-t md:border p-5 md:p-4 pb-8 md:pb-4 z-40 md:z-10 backdrop-blur-xl flex flex-col gap-4 pointer-events-auto transition-transform md:transition-colors duration-300 ${
          isInspectorOpenMobile ? 'translate-y-0' : 'translate-y-full md:translate-y-0'
        }`}
             style={{ 
               backgroundColor: isDarkTheme ? 'rgba(30, 41, 59, 0.75)' : 'rgba(255, 255, 255, 0.85)',
               borderColor: isDarkTheme ? '#334155' : '#e2e8f0'
             }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5 text-indigo-400" />
              <h4 className="text-[10px] font-bold tracking-wider uppercase opacity-50">CANVAS INSPECTOR</h4>
            </div>
            <button 
              onClick={() => setIsInspectorOpenMobile(false)}
              className="md:hidden p-1 text-slate-500 hover:text-white rounded-lg cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          
          <div className="h-[1px] bg-slate-800/40"></div>

          {/* Fill/Color Selector */}
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-2">Color Accent</span>
            <div className="grid grid-cols-5 gap-1.5">
              {COLORS.map((col) => (
                <button
                  key={col}
                  onClick={() => setStrokeColor(col)}
                  className="w-6 h-6 rounded-full border border-slate-900/40 shadow-inner relative flex items-center justify-center cursor-pointer hover:scale-110 transition-transform"
                  style={{ backgroundColor: col }}
                >
                  {strokeColor === col && (
                    <div className="w-1.5 h-1.5 rounded-full bg-white mix-blend-difference"></div>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Stroke Width Selector */}
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-2">Stroke Width</span>
            <div className="grid grid-cols-3 gap-1.5">
              {[2, 4, 8].map((w) => (
                <button
                  key={w}
                  onClick={() => setStrokeWidth(w)}
                  className={`py-1 rounded-lg border text-[10px] font-bold tracking-wider transition-all cursor-pointer ${
                    strokeWidth === w 
                      ? 'bg-indigo-600 text-white border-indigo-500 shadow' 
                      : isDarkTheme 
                        ? 'border-slate-800 bg-slate-950/40 hover:bg-slate-800 text-slate-400' 
                        : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-600'
                  }`}
                >
                  {w}px
                </button>
              ))}
            </div>
          </div>

          {/* Fill Color selection for shapes */}
          {(activeTool === 'rectangle' || activeTool === 'circle' || activeTool === 'sticky') && (
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-2">Fill Style</span>
              <div className="grid grid-cols-5 gap-1.5">
                <button
                  onClick={() => setFillColor('transparent')}
                  className={`w-6 h-6 rounded-full border border-dashed flex items-center justify-center text-[8px] font-bold uppercase cursor-pointer hover:scale-105 transition-all ${
                    fillColor === 'transparent' ? 'border-indigo-500 bg-indigo-500/10 text-indigo-400 font-bold' : 'border-slate-500 text-slate-500'
                  }`}
                  title="Transparent"
                >
                  None
                </button>
                {activeTool === 'sticky' ? (
                  STICKY_COLORS.map((col) => (
                    <button
                      key={col}
                      onClick={() => setFillColor(col)}
                      className="w-6 h-6 rounded-full border border-slate-900/40 shadow-inner cursor-pointer hover:scale-110 transition-transform"
                      style={{ backgroundColor: col }}
                    />
                  ))
                ) : (
                  COLORS.slice(0, 4).map((col) => (
                    <button
                      key={col}
                      onClick={() => setFillColor(col)}
                      className="w-6 h-6 rounded-full border border-slate-900/40 shadow-inner cursor-pointer hover:scale-110 transition-transform"
                      style={{ backgroundColor: col }}
                    />
                  ))
                )}
              </div>
            </div>
          )}

          {/* Opacity slider */}
          <div>
            <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
              <span>Opacity</span>
              <span>{Math.round(opacity * 100)}%</span>
            </div>
            <input
              type="range"
              min="0.1"
              max="1"
              step="0.1"
              value={opacity}
              onChange={(e) => setOpacity(parseFloat(e.target.value))}
              className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500 focus:outline-none"
            />
          </div>

          {/* Font selection overlay when text tool active */}
          {activeTool === 'text' && (
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-2">Font Family</span>
              <div className="grid grid-cols-3 gap-1.5">
                {['sans', 'mono', 'serif'].map((font) => (
                  <button
                    key={font}
                    onClick={() => setFontFamily(font)}
                    className={`py-1 rounded-lg border text-[10px] font-semibold uppercase tracking-wider cursor-pointer ${
                      fontFamily === font 
                        ? 'bg-indigo-600 text-white border-indigo-500 shadow' 
                        : isDarkTheme ? 'border-slate-800 bg-slate-950/40 hover:bg-slate-800 text-slate-400' : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-600'
                    }`}
                  >
                    {font}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Active Selection Controls */}
          {selectedElementId && activeTool === 'select' && (() => {
            const selectedElement = elements.find(el => el.id === selectedElementId);
            return (
              <div className="border-t border-slate-800/60 pt-3 mt-1 flex flex-col gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Selection Controls</span>
                
                {selectedElement && selectedElement.type === 'sticky' && (
                  <div className="mb-1">
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">Card Color</span>
                    <div className="flex gap-1.5 flex-wrap">
                      {STICKY_COLORS.map((col) => (
                        <button
                          key={col}
                          disabled={currentUserRole === 'viewer'}
                          onClick={async () => {
                            if (currentUserRole === 'viewer') return;
                            await updateDoc(doc(db, 'boards', boardId, 'elements', selectedElementId), {
                              bgColor: col,
                              updatedBy: user?.uid || 'anonymous',
                              updatedAt: Date.now()
                            });
                          }}
                          className={`w-5 h-5 rounded-full border cursor-pointer transition-transform hover:scale-110 shrink-0 ${
                            selectedElement.bgColor === col ? 'ring-2 ring-indigo-500 border-white scale-110' : 'border-slate-850/60'
                          }`}
                          style={{ backgroundColor: col }}
                          title="Change sticky note color"
                        />
                      ))}
                    </div>
                  </div>
                )}

                {selectedElement && (selectedElement.type === 'sticky' || selectedElement.type === 'text') && (
                  <button
                    disabled={currentUserRole === 'viewer'}
                    onClick={() => {
                      if (currentUserRole === 'viewer') return;
                      setEditingTextElement({
                        id: selectedElement.id,
                        type: selectedElement.type as 'text' | 'sticky',
                        x: selectedElement.type === 'sticky' ? (selectedElement as StickyElement).x : (selectedElement as TextElement).x,
                        y: selectedElement.type === 'sticky' ? (selectedElement as StickyElement).y : (selectedElement as TextElement).y,
                        text: selectedElement.text,
                        bgColor: selectedElement.type === 'sticky' ? (selectedElement as StickyElement).bgColor : undefined
                      });
                    }}
                    className={`w-full py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                      currentUserRole === 'viewer'
                        ? 'bg-slate-800/40 text-slate-600 cursor-not-allowed opacity-40'
                        : 'bg-indigo-600/10 hover:bg-indigo-600/25 text-indigo-400 hover:text-indigo-300 cursor-pointer border border-indigo-500/10'
                    }`}
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>Edit Content</span>
                  </button>
                )}

                <button
                  disabled={currentUserRole === 'viewer'}
                  onClick={async () => {
                    if (currentUserRole === 'viewer') return;
                    const deleting = elements.find(el => el.id === selectedElementId);
                    if (deleting) {
                      setUndoStack(prev => [...prev, { action: 'delete', id: selectedElementId, element: deleting }]);
                      await deleteDoc(doc(db, 'boards', boardId, 'elements', selectedElementId));
                      setSelectedElementId(null);
                    }
                  }}
                  className={`w-full py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                    currentUserRole === 'viewer'
                      ? 'bg-slate-800/40 text-slate-600 cursor-not-allowed opacity-40'
                      : 'bg-rose-600/10 hover:bg-rose-600/25 text-rose-500 hover:text-rose-400 cursor-pointer border border-rose-500/10'
                  }`}
                >
                  <Trash className="w-3.5 h-3.5" />
                  <span>Delete Selected</span>
                </button>
              </div>
            );
          })()}
        </div>

        {/* Mobile/Tablet Inspector Toggle Button */}
        <button
          onClick={() => setIsInspectorOpenMobile(!isInspectorOpenMobile)}
          className="md:hidden fixed bottom-20 right-4 w-11 h-11 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center shadow-xl border border-indigo-500/30 active:scale-95 duration-150 z-30 cursor-pointer animate-in fade-in zoom-in duration-300"
          title="Canvas Inspector"
        >
          <Sliders className="w-4.5 h-4.5" />
        </button>

        {/* Central interactive whiteboard canvas */}
        <div ref={containerRef} className="flex-1 w-full h-full relative overflow-hidden bg-transparent">
          <canvas
            ref={canvasRef}
            onMouseDown={handlePointerDown}
            onMouseMove={handlePointerMove}
            onMouseUp={handlePointerUp}
            onMouseLeave={handlePointerUp}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onDoubleClick={handleCanvasDoubleClick}
            style={{ cursor: activeTool === 'hand' || (isSpacePressed && !isInputActive()) ? (isPanning ? 'grabbing' : 'grab') : (activeTool === 'select' ? canvasCursor : (activeTool === 'eraser' ? 'not-allowed' : 'crosshair')) }}
            className={`block h-full w-full touch-none ${isDarkTheme ? 'bg-slate-950' : 'bg-white'}`}
          />

          {/* Interactive Whiteboard MiniMap */}
          <MiniMap
            elements={elements}
            currentPage={currentPage}
            zoom={zoom}
            pan={pan}
            setPan={setPan}
            isDarkTheme={isDarkTheme}
            containerRef={containerRef}
          />

          {/* Real-time styled editable inputs for Text & Sticky notes overlay */}
          {editingTextElement && (
            <div 
              className="absolute z-40 p-3.5 rounded-2xl shadow-2xl flex flex-col gap-2 border"
              style={{
                left: `${editingTextElement.x * zoom + pan.x}px`,
                top: `${editingTextElement.y * zoom + pan.y}px`,
                transform: `scale(${zoom})`,
                transformOrigin: 'top left',
                backgroundColor: editingTextElement.type === 'sticky' 
                  ? (editingTextElement.bgColor || '#fef08a') 
                  : (isDarkTheme ? '#1e293b' : '#ffffff'),
                borderColor: editingTextElement.type === 'sticky' ? 'transparent' : '#3b82f6',
                width: editingTextElement.type === 'sticky' ? '220px' : '320px'
              }}
            >
              <textarea
                value={editingTextElement.text}
                onChange={(e) => setEditingTextElement({ ...editingTextElement, text: e.target.value })}
                onBlur={saveTextOverlayEdit}
                className={`w-full bg-transparent border-none outline-none text-xs p-1 leading-relaxed font-bold resize-none ${
                  editingTextElement.type === 'sticky'
                    ? 'text-slate-800 placeholder-slate-500'
                    : (isDarkTheme ? 'text-white placeholder-slate-400' : 'text-slate-900 placeholder-slate-400')
                }`}
                placeholder={editingTextElement.type === 'sticky' ? 'Write some sticky note comments...' : 'Type anything here...'}
                rows={editingTextElement.type === 'sticky' ? 5 : 3}
                autoFocus
              />
              <div className="flex justify-between items-center px-1 pt-1.5 border-t border-slate-950/10">
                <span className="text-[8px] text-slate-500 font-black uppercase tracking-widest">{editingTextElement.type} mode</span>
                <button 
                  onMouseDown={(e) => {
                    e.preventDefault(); // prevent blur before click
                    saveTextOverlayEdit();
                  }}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg p-1 cursor-pointer"
                >
                  <CheckCircle className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Floating Canvas Controls - bottom left (Undo, Redo, Zoom, Clear) */}
          <div className="fixed md:absolute bottom-20 md:bottom-6 left-4 md:left-6 flex items-center gap-1 p-1 md:p-1.5 rounded-2xl border shadow-2xl z-10 backdrop-blur-xl transition-all duration-300 max-sm:scale-90 max-sm:origin-bottom-left"
               style={{ 
                 backgroundColor: isDarkTheme ? 'rgba(15, 23, 42, 0.75)' : 'rgba(255, 255, 255, 0.85)',
                 borderColor: isDarkTheme ? '#1e293b' : '#e2e8f0'
               }}>
            
            {/* Undo */}
            <button
              onClick={handleUndo}
              className={`p-2 rounded-xl transition-all duration-150 hover:scale-105 active:scale-95 cursor-pointer ${isDarkTheme ? 'hover:bg-slate-800 text-slate-400 hover:text-slate-100' : 'hover:bg-slate-100 text-slate-600 hover:text-slate-900'}`}
              title="Undo"
            >
              <Undo className="w-4 h-4" />
            </button>

            {/* Redo */}
            <button
              onClick={handleRedo}
              className={`p-2 rounded-xl transition-all duration-150 hover:scale-105 active:scale-95 cursor-pointer ${isDarkTheme ? 'hover:bg-slate-800 text-slate-400 hover:text-slate-100' : 'hover:bg-slate-100 text-slate-600 hover:text-slate-900'}`}
              title="Redo"
            >
              <Redo className="w-4 h-4" />
            </button>

            <div className={`h-5 w-[1px] ${isDarkTheme ? 'bg-slate-850' : 'bg-slate-200'}`}></div>

            {/* Zoom Out */}
            <button
              onClick={() => zoomInViewportCenter(0.9)}
              className={`p-2 rounded-xl transition-all duration-150 hover:scale-105 active:scale-95 cursor-pointer ${isDarkTheme ? 'hover:bg-slate-800 text-slate-400 hover:text-slate-100' : 'hover:bg-slate-100 text-slate-600 hover:text-slate-900'}`}
              title="Zoom Out"
            >
              <ZoomOut className="w-4 h-4" />
            </button>

            <span className="text-[10px] font-mono font-black px-1.5 min-w-[40px] text-center text-indigo-400 select-none">
              {Math.round(zoom * 100)}%
            </span>

            {/* Zoom In */}
            <button
              onClick={() => zoomInViewportCenter(1.1)}
              className={`p-2 rounded-xl transition-all duration-150 hover:scale-105 active:scale-95 cursor-pointer ${isDarkTheme ? 'hover:bg-slate-800 text-slate-400 hover:text-slate-100' : 'hover:bg-slate-100 text-slate-600 hover:text-slate-900'}`}
              title="Zoom In"
            >
              <ZoomIn className="w-4 h-4" />
            </button>

            <div className={`h-5 w-[1px] ${isDarkTheme ? 'bg-slate-850' : 'bg-slate-200'}`}></div>

            {/* Reset View */}
            <button
              onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}
              className={`px-2.5 py-2 rounded-xl transition-all duration-150 hover:scale-105 active:scale-95 text-[9px] font-black tracking-wider cursor-pointer ${isDarkTheme ? 'hover:bg-slate-800 text-slate-400 hover:text-slate-100' : 'hover:bg-slate-100 text-slate-600 hover:text-slate-900'}`}
              title="Reset Zoom"
            >
              100%
            </button>

            {/* Clear Board canvas */}
            <button
              onClick={handleClearCanvas}
              className="p-2 rounded-xl hover:bg-rose-500/20 text-rose-500 hover:text-rose-400 transition-all duration-150 hover:scale-105 active:scale-95 cursor-pointer"
              title="Clear Canvas"
            >
              <Trash className="w-4 h-4" />
            </button>
          </div>

          {/* Floating Pagination panel - Bottom Center (Multi-page canvas support) */}
          <div className="fixed md:absolute bottom-32 md:bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 px-4 py-2 rounded-2xl border shadow-2xl z-10 backdrop-blur-xl transition-all duration-300 max-sm:scale-95"
               style={{ 
                 backgroundColor: isDarkTheme ? 'rgba(15, 23, 42, 0.75)' : 'rgba(255, 255, 255, 0.85)',
                 borderColor: isDarkTheme ? '#1e293b' : '#e2e8f0'
               }}>
            <button
              disabled={currentPage === 0}
              onClick={handlePrevPage}
              className={`p-1.5 rounded-xl transition-all cursor-pointer ${currentPage === 0 ? 'opacity-30 cursor-not-allowed' : 'hover:bg-slate-800/80 text-white'}`}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="text-[11px] font-bold select-none flex items-center gap-1 uppercase tracking-wider">
              <span className="opacity-40">Page</span>
              <span className="font-mono text-xs font-black text-indigo-400">{currentPage + 1}</span>
              <span className="opacity-30">/</span>
              <span className="font-mono text-xs opacity-60">{board?.pagesCount || 1}</span>
            </div>
            <button
              onClick={handleNextPage}
              className="p-1.5 rounded-xl hover:bg-slate-800/80 transition-all cursor-pointer text-indigo-400"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Chat System Box Toggle button (Bottom Right) */}
          <button
            onClick={() => setIsChatOpen(!isChatOpen)}
            className="fixed md:absolute bottom-20 md:bottom-6 right-4 md:right-6 flex items-center gap-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white px-5 py-3 rounded-2xl shadow-2xl shadow-indigo-950/40 active:scale-95 duration-150 font-bold text-xs cursor-pointer z-10 border border-indigo-400/20"
          >
            <MessageSquare className="w-4 h-4" />
            <span>Chat ({messages.length})</span>
          </button>
        </div>

        {/* Sliding Chat drawer overlay (collapsible sidebar) */}
        {isChatOpen && (
          <aside className={`fixed md:relative inset-y-0 right-0 z-50 md:z-30 w-full sm:w-80 h-full border-l flex flex-col shrink-0 shadow-2xl transition-colors duration-300 ${
            isDarkTheme ? 'bg-slate-900 border-slate-850 text-white' : 'bg-white border-slate-200 text-slate-900'
          }`}>
            <div className="p-4 border-b border-slate-900/60 flex items-center justify-between bg-slate-950/20">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4.5 h-4.5 text-indigo-400" />
                <h3 className="font-display font-extrabold text-sm tracking-tight text-white">Live Channel Chat</h3>
              </div>
              <button 
                onClick={() => setIsChatOpen(false)}
                className="p-1.5 rounded-xl hover:bg-slate-800/80 hover:text-white transition-all text-slate-400 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Chat Stream message list */}
            <div className="flex-1 p-4 overflow-y-auto space-y-4">
              {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-center text-slate-500 text-xs">
                  <div className="w-12 h-12 rounded-2xl bg-slate-950/60 border border-slate-900 flex items-center justify-center text-slate-600 mb-4">
                    <MessageSquare className="w-5 h-5" />
                  </div>
                  <p className="font-bold text-slate-400">No Chat Activity</p>
                  <p className="opacity-80 mt-1 max-w-[180px] leading-relaxed mx-auto text-[10px]">Send a greeting message to connected board team participants.</p>
                </div>
              ) : (
                <>
                  {messages.map((msg) => {
                    const isSelf = msg.userId === user?.uid;
                    return (
                      <div 
                        key={msg.id} 
                        className={`flex flex-col max-w-[85%] ${isSelf ? 'ml-auto items-end' : 'mr-auto items-start'}`}
                      >
                        <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                          <span 
                            className="w-1.5 h-1.5 rounded-full shrink-0" 
                            style={{ backgroundColor: msg.userColor }}
                          />
                          <span className="text-[9px] font-bold opacity-50">
                            {isSelf ? 'You' : msg.userName}
                          </span>
                          {msg.createdAt && (
                            <span className="text-[8px] text-slate-500 font-mono select-none opacity-40">
                              {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          )}
                        </div>
                        <div className={`p-3 rounded-2xl text-xs leading-relaxed shadow-md break-words ${
                          isSelf 
                            ? 'bg-gradient-to-tr from-indigo-600 to-purple-600 text-white rounded-tr-none border border-indigo-400/10' 
                            : (isDarkTheme ? 'bg-slate-950 text-slate-300 rounded-tl-none border border-slate-900/60' : 'bg-slate-100 text-slate-800 rounded-tl-none')
                        }`}>
                          {msg.text}
                        </div>
                      </div>
                    );
                  })}
                  <div ref={chatEndRef} />
                </>
              )}
            </div>

            {/* Input Form container */}
            <form onSubmit={handleSendChatMessage} className="p-4 border-t border-slate-900/60 flex gap-2 bg-slate-950/20">
              <input
                type="text"
                placeholder="Type messages..."
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                className={`flex-1 rounded-xl text-xs px-3.5 py-2.5 outline-none border transition-all ${
                  isDarkTheme 
                    ? 'bg-slate-950 border-slate-900 text-white focus:bg-slate-950 focus:border-indigo-500' 
                    : 'bg-slate-50 border-slate-200 text-slate-800 focus:bg-white focus:border-indigo-500'
                }`}
              />
              <button 
                type="submit"
                className="bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl p-2.5 shadow-lg shadow-indigo-600/10 active:scale-95 duration-150 shrink-0 cursor-pointer"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </aside>
        )}
      </div>

      {/* Invite Share Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className={`w-full max-w-md rounded-2xl border shadow-2xl overflow-hidden animate-in fade-in duration-200 ${
            isDarkTheme ? 'bg-slate-900 border-slate-850 text-white' : 'bg-white border-slate-200 text-slate-800'
          }`}>
            <div className="px-6 py-4 border-b border-slate-900/40 flex items-center justify-between bg-slate-950/20">
              <h3 className="font-display font-extrabold text-base text-white">Invite Workspace Contributors</h3>
              <button 
                onClick={() => setShowInviteModal(false)}
                className="p-1.5 text-slate-500 hover:text-white hover:bg-slate-800/40 rounded-xl cursor-pointer"
              >
                <X className="w-4.5 h-4.5" />
              </button>
            </div>

            <div className="p-6 space-y-5">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider opacity-60 block mb-2 ml-1">
                  Board Invitation Link
                </span>
                <div className={`flex rounded-xl overflow-hidden border ${isDarkTheme ? 'bg-slate-950 border-slate-850' : 'bg-slate-50 border-slate-250'}`}>
                  <input
                    type="text"
                    readOnly
                    value={`${window.location.origin}/board/${boardId}`}
                    className="flex-1 bg-transparent px-3 py-2.5 text-xs text-indigo-400 truncate font-mono outline-none font-medium"
                  />
                  <button
                    onClick={handleCopyInviteLink}
                    className="bg-indigo-600 hover:bg-indigo-500 text-white px-5 flex items-center justify-center font-bold text-xs transition-all cursor-pointer"
                  >
                    {copiedLink ? <Check className="w-4 h-4" /> : 'Copy'}
                  </button>
                </div>
                <p className="text-[10px] opacity-40 mt-2 leading-relaxed px-1">
                  Copy and send this unique board URL to any other connected participant. They can join instantly.
                </p>
              </div>

              <div className="border-t border-slate-800/60 pt-4 space-y-4">
                {currentUserRole === 'owner' ? (
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider opacity-60 block mb-2 ml-1">
                      Invite Collaborator by Email
                    </span>
                    <form onSubmit={handleAddCollaborator} className="flex gap-2">
                      <input
                        type="email"
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                        placeholder="colleague@company.com"
                        className={`flex-1 text-xs px-3 py-2.5 rounded-xl border outline-none ${
                          isDarkTheme ? 'bg-slate-950 border-slate-850 text-white placeholder-slate-700' : 'bg-slate-50 border-slate-250 text-slate-800 placeholder-slate-400'
                        }`}
                      />
                      <button
                        type="submit"
                        className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 rounded-xl font-bold text-xs transition-all cursor-pointer flex items-center gap-1 shrink-0"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add</span>
                      </button>
                    </form>
                    {inviteError && (
                      <p className="text-[10px] text-rose-500 mt-1.5 ml-1 font-medium">{inviteError}</p>
                    )}
                  </div>
                ) : (
                  <div className={`p-3 rounded-xl text-xs border ${isDarkTheme ? 'bg-slate-950/40 border-slate-850/60 text-slate-400' : 'bg-slate-50 border-slate-200 text-slate-500'}`}>
                    <Lock className="w-3.5 h-3.5 inline-block mr-1.5 align-text-bottom text-amber-500" />
                    Only the board Owner can invite new collaborators or modify roles.
                  </div>
                )}

                {/* List of current invited collaborators */}
                {board?.collaborators && board.collaborators.length > 0 && (
                  <div className="space-y-1.5">
                    <span className="text-[9px] font-bold uppercase tracking-wider opacity-40 block ml-1">
                      Invited Collaborators ({board.collaborators.length})
                    </span>
                    <div className="max-h-32 overflow-y-auto pr-1 space-y-1.5">
                      {board.collaborators.map((email) => (
                        <div 
                          key={email}
                          className={`flex items-center justify-between px-3 py-2 rounded-xl text-xs border ${
                            isDarkTheme ? 'bg-slate-950/60 border-slate-850/60 text-slate-300' : 'bg-slate-50/60 border-slate-200 text-slate-600'
                          }`}
                        >
                          <div className="flex flex-col min-w-0">
                            <span className="truncate font-mono">{email}</span>
                          </div>
                          
                          <div className="flex items-center gap-2 shrink-0">
                            {board.ownerId === user?.uid ? (
                              <select
                                value={board.permissions?.[email.toLowerCase()] || 'editor'}
                                onChange={async (e) => {
                                  const newRole = e.target.value;
                                  const updatedPermissions = { ...(board.permissions || {}) };
                                  updatedPermissions[email.toLowerCase()] = newRole;
                                  await updateDoc(doc(db, 'boards', boardId), {
                                    permissions: updatedPermissions
                                  });
                                }}
                                className={`text-[10px] font-bold outline-none rounded px-1.5 py-0.5 border cursor-pointer ${
                                  isDarkTheme 
                                    ? 'bg-slate-950 border-slate-800 text-indigo-400 focus:border-indigo-500' 
                                    : 'bg-white border-slate-200 text-indigo-600 focus:border-indigo-500'
                                }`}
                              >
                                <option value="editor" className="bg-slate-900 text-white">Editor</option>
                                <option value="viewer" className="bg-slate-900 text-white">Viewer</option>
                              </select>
                            ) : (
                              <span className={`text-[9px] uppercase tracking-wider font-extrabold px-1.5 py-0.5 rounded ${
                                (board.permissions?.[email.toLowerCase()] || 'editor') === 'viewer'
                                  ? 'bg-slate-800 text-slate-400'
                                  : 'bg-indigo-950/40 text-indigo-400'
                              }`}>
                                {board.permissions?.[email.toLowerCase()] || 'editor'}
                              </span>
                            )}

                            {board.ownerId === user?.uid && (
                              <button
                                onClick={() => handleRemoveCollaborator(email)}
                                className="p-1 text-slate-500 hover:text-rose-500 rounded transition-all cursor-pointer"
                                title="Remove invitation"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="px-6 py-4.5 bg-slate-950/40 border-t border-slate-900/60 flex items-center justify-end"
                 style={{ backgroundColor: isDarkTheme ? '#121b2d' : '#f8f9ff', borderTopColor: isDarkTheme ? '#1e293b' : '#f1f5f9' }}>
              <button
                onClick={() => setShowInviteModal(false)}
                className="px-5 py-2.5 bg-indigo-600 text-white text-xs font-bold rounded-xl hover:bg-indigo-500 transition-all shadow-lg cursor-pointer"
              >
                Close Panel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
