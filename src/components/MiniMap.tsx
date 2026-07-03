import React, { useRef, useEffect, useState } from 'react';
import { Map, Minimize2, Maximize2, Compass } from 'lucide-react';
import { BoardElement, Point } from '../types';

interface MiniMapProps {
  elements: BoardElement[];
  currentPage: number;
  zoom: number;
  pan: Point;
  setPan: (pan: Point | ((prev: Point) => Point)) => void;
  isDarkTheme: boolean;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

export const MiniMap: React.FC<MiniMapProps> = ({
  elements,
  currentPage,
  zoom,
  pan,
  setPan,
  isDarkTheme,
  containerRef
}) => {
  const [isMinimized, setIsMinimized] = useState<boolean>(false);
  const mapCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Constants for mini-map viewport display size (in CSS pixels)
  const MM_WIDTH = 200;
  const MM_HEIGHT = 135;

  // Function to calculate all world space boundaries and projections
  const getBoundsAndProjections = () => {
    const canvas = mapCanvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return null;

    const containerRect = container.getBoundingClientRect();
    const containerWidth = containerRect.width || 800;
    const containerHeight = containerRect.height || 600;

    // 1. Calculate elements bounds in world space
    let elMinX = Infinity;
    let elMaxX = -Infinity;
    let elMinY = Infinity;
    let elMaxY = -Infinity;
    let hasElements = false;

    const pageFilteredElements = elements.filter(el => (el.page || 0) === currentPage);
    pageFilteredElements.forEach(el => {
      hasElements = true;
      if (el.type === 'pencil' && el.points) {
        el.points.forEach(p => {
          if (p.x < elMinX) elMinX = p.x;
          if (p.x > elMaxX) elMaxX = p.x;
          if (p.y < elMinY) elMinY = p.y;
          if (p.y > elMaxY) elMaxY = p.y;
        });
      } else if (el.type === 'line') {
        const xMin = Math.min(el.x1, el.x2);
        const xMax = Math.max(el.x1, el.x2);
        const yMin = Math.min(el.y1, el.y2);
        const yMax = Math.max(el.y1, el.y2);
        if (xMin < elMinX) elMinX = xMin;
        if (xMax > elMaxX) elMaxX = xMax;
        if (yMin < elMinY) elMinY = yMin;
        if (yMax > elMaxY) elMaxY = yMax;
      } else if (el.type === 'circle') {
        const rx = Math.abs(el.rx || 0);
        const ry = Math.abs(el.ry || 0);
        if (el.cx - rx < elMinX) elMinX = el.cx - rx;
        if (el.cx + rx > elMaxX) elMaxX = el.cx + rx;
        if (el.cy - ry < elMinY) elMinY = el.cy - ry;
        if (el.cy + ry > elMaxY) elMaxY = el.cy + ry;
      } else if (el.type === 'rectangle' || el.type === 'sticky') {
        if (el.x < elMinX) elMinX = el.x;
        if (el.x + el.width > elMaxX) elMaxX = el.x + el.width;
        if (el.y < elMinY) elMinY = el.y;
        if (el.y + el.height > elMaxY) elMaxY = el.y + el.height;
      } else if (el.type === 'text') {
        const w = el.text ? el.text.length * 8 : 50;
        const h = 20;
        if (el.x < elMinX) elMinX = el.x;
        if (el.x + w > elMaxX) elMaxX = el.x + w;
        if (el.y < elMinY) elMinY = el.y;
        if (el.y + h > elMaxY) elMaxY = el.y + h;
      }
    });

    // 2. Viewport bounds in world space
    const viewportMinX = -pan.x / zoom;
    const viewportMinY = -pan.y / zoom;
    const viewportWidth = containerWidth / zoom;
    const viewportHeight = containerHeight / zoom;
    const viewportMaxX = viewportMinX + viewportWidth;
    const viewportMaxY = viewportMinY + viewportHeight;

    // 3. Combined total bounds to display on mini-map (viewport + elements)
    let totalMinX = Math.min(viewportMinX, hasElements ? elMinX : -1000);
    let totalMaxX = Math.max(viewportMaxX, hasElements ? elMaxX : 1000);
    let totalMinY = Math.min(viewportMinY, hasElements ? elMinY : -1000);
    let totalMaxY = Math.max(viewportMaxY, hasElements ? elMaxY : 1000);

    // Add padding (15% margins on each side to give nice framing)
    const paddingX = Math.max(150, (totalMaxX - totalMinX) * 0.15);
    const paddingY = Math.max(150, (totalMaxY - totalMinY) * 0.15);
    totalMinX -= paddingX;
    totalMaxX += paddingX;
    totalMinY -= paddingY;
    totalMaxY += paddingY;

    // Enforce reasonable minimal dimensions so the map isn't infinitely zoomed
    const currentBoundsWidth = totalMaxX - totalMinX;
    const currentBoundsHeight = totalMaxY - totalMinY;
    if (currentBoundsWidth < 2000) {
      const diff = (2000 - currentBoundsWidth) / 2;
      totalMinX -= diff;
      totalMaxX += diff;
    }
    if (currentBoundsHeight < 1500) {
      const diff = (1500 - currentBoundsHeight) / 2;
      totalMinY -= diff;
      totalMaxY += diff;
    }

    const boundsWidth = totalMaxX - totalMinX;
    const boundsHeight = totalMaxY - totalMinY;

    // 4. Calculate scaling & offset preserving 4:3 aspect ratio
    const mapAspect = MM_WIDTH / MM_HEIGHT;
    const boundsAspect = boundsWidth / boundsHeight;

    let scaleFactor: number;
    let offsetX = 0;
    let offsetY = 0;

    if (boundsAspect > mapAspect) {
      scaleFactor = MM_WIDTH / boundsWidth;
      offsetY = (MM_HEIGHT - boundsHeight * scaleFactor) / 2;
    } else {
      scaleFactor = MM_HEIGHT / boundsHeight;
      offsetX = (MM_WIDTH - boundsWidth * scaleFactor) / 2;
    }

    const worldToMap = (wx: number, wy: number) => {
      return {
        x: offsetX + (wx - totalMinX) * scaleFactor,
        y: offsetY + (wy - totalMinY) * scaleFactor
      };
    };

    const mapToWorld = (mx: number, my: number) => {
      return {
        x: totalMinX + (mx - offsetX) / scaleFactor,
        y: totalMinY + (my - offsetY) / scaleFactor
      };
    };

    return {
      worldToMap,
      mapToWorld,
      viewportMinX,
      viewportMinY,
      viewportWidth,
      viewportHeight,
      pageFilteredElements,
      containerWidth,
      containerHeight
    };
  };

  // Render Minimap Content
  useEffect(() => {
    if (isMinimized) return;

    const canvas = mapCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const projections = getBoundsAndProjections();
    if (!projections) return;

    const {
      worldToMap,
      viewportMinX,
      viewportMinY,
      viewportWidth,
      viewportHeight,
      pageFilteredElements
    } = projections;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = MM_WIDTH * dpr;
    canvas.height = MM_HEIGHT * dpr;
    canvas.style.width = `${MM_WIDTH}px`;
    canvas.style.height = `${MM_HEIGHT}px`;
    ctx.scale(dpr, dpr);

    // 1. Draw mini-map background
    ctx.fillStyle = isDarkTheme ? '#0b0f19' : '#f8fafc'; // matching app dark / light theme
    ctx.fillRect(0, 0, MM_WIDTH, MM_HEIGHT);

    // 2. Render all page elements in miniature
    pageFilteredElements.forEach(el => {
      ctx.save();
      // Render elements on the map with slightly muted opacity for elegance
      ctx.globalAlpha = (el.opacity ?? 1) * 0.75;
      ctx.strokeStyle = el.color;
      ctx.fillStyle = el.fillColor && el.fillColor !== 'transparent' ? el.fillColor : el.color;
      
      // Scale stroke width so that lines are visible but thin
      ctx.lineWidth = Math.max(1, (el.strokeWidth ?? 4) * 0.2);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      switch (el.type) {
        case 'pencil':
          if (el.points && el.points.length > 0) {
            ctx.beginPath();
            const p0 = worldToMap(el.points[0].x, el.points[0].y);
            ctx.moveTo(p0.x, p0.y);
            for (let i = 1; i < el.points.length; i++) {
              const p = worldToMap(el.points[i].x, el.points[i].y);
              ctx.lineTo(p.x, p.y);
            }
            ctx.stroke();
          }
          break;

        case 'line':
          const p1 = worldToMap(el.x1, el.y1);
          const p2 = worldToMap(el.x2, el.y2);
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.stroke();
          break;

        case 'rectangle': {
          const rPos = worldToMap(el.x, el.y);
          const rBR = worldToMap(el.x + el.width, el.y + el.height);
          const rw = rBR.x - rPos.x;
          const rh = rBR.y - rPos.y;

          ctx.beginPath();
          if (el.fillColor && el.fillColor !== 'transparent') {
            ctx.fillStyle = el.fillColor;
            ctx.fillRect(rPos.x, rPos.y, rw, rh);
          }
          ctx.rect(rPos.x, rPos.y, rw, rh);
          ctx.stroke();
          break;
        }

        case 'circle': {
          const cCenter = worldToMap(el.cx, el.cy);
          const cEdge = worldToMap(el.cx + Math.abs(el.rx), el.cy + Math.abs(el.ry));
          const rx = Math.abs(cEdge.x - cCenter.x);
          const ry = Math.abs(cEdge.y - cCenter.y);

          ctx.beginPath();
          ctx.ellipse(cCenter.x, cCenter.y, rx, ry, 0, 0, Math.PI * 2);
          if (el.fillColor && el.fillColor !== 'transparent') {
            ctx.fillStyle = el.fillColor;
            ctx.fill();
          }
          ctx.stroke();
          break;
        }

        case 'sticky': {
          const sPos = worldToMap(el.x, el.y);
          const sBR = worldToMap(el.x + el.width, el.y + el.height);
          const sw = sBR.x - sPos.x;
          const sh = sBR.y - sPos.y;

          ctx.fillStyle = el.bgColor || '#fef08a';
          ctx.beginPath();
          if (ctx.roundRect) {
            ctx.roundRect(sPos.x, sPos.y, sw, sh, 2);
          } else {
            ctx.rect(sPos.x, sPos.y, sw, sh);
          }
          ctx.fill();

          ctx.strokeStyle = 'rgba(0, 0, 0, 0.15)';
          ctx.lineWidth = 0.5;
          ctx.stroke();
          break;
        }

        case 'text': {
          const tPos = worldToMap(el.x, el.y);
          ctx.fillStyle = el.color;
          // Simple visual block for texts
          ctx.fillRect(tPos.x, tPos.y - 1, 12, 2.5);
          break;
        }
      }
      ctx.restore();
    });

    // 3. Draw visible view port rectangle (semi-transparent Indigo with clear border)
    const vTopLeft = worldToMap(viewportMinX, viewportMinY);
    const vBottomRight = worldToMap(viewportMinX + viewportWidth, viewportMinY + viewportHeight);
    const vw = vBottomRight.x - vTopLeft.x;
    const vh = vBottomRight.y - vTopLeft.y;

    ctx.save();
    ctx.strokeStyle = '#6366f1'; // Indigo-500
    ctx.lineWidth = 1.5;
    ctx.fillStyle = 'rgba(99, 102, 241, 0.08)'; // trans-indigo tint
    ctx.fillRect(vTopLeft.x, vTopLeft.y, vw, vh);
    ctx.strokeRect(vTopLeft.x, vTopLeft.y, vw, vh);
    ctx.restore();

  }, [elements, currentPage, zoom, pan, isDarkTheme, isMinimized]);

  // Handle Dragging / Clicking on Minimap
  const isInteracting = useRef<boolean>(false);

  const handleInteraction = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = mapCanvasRef.current;
    if (!canvas) return;

    const projections = getBoundsAndProjections();
    if (!projections) return;

    const { mapToWorld, containerWidth, containerHeight } = projections;
    const rect = canvas.getBoundingClientRect();
    
    let clientX = 0;
    let clientY = 0;

    if ('touches' in e) {
      if (e.touches.length === 0) return;
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    const mx = clientX - rect.left;
    const my = clientY - rect.top;

    // Clamp inside map canvas coordinates
    const clampedMx = Math.max(0, Math.min(MM_WIDTH, mx));
    const clampedMy = Math.max(0, Math.min(MM_HEIGHT, my));

    // Map to world coordinates
    const { x: wx, y: wy } = mapToWorld(clampedMx, clampedMy);

    // Update main pan coordinates to center view around (wx, wy)
    const newPanX = containerWidth / 2 - wx * zoom;
    const newPanY = containerHeight / 2 - wy * zoom;

    setPan({ x: newPanX, y: newPanY });
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    isInteracting.current = true;
    handleInteraction(e);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isInteracting.current) {
      handleInteraction(e);
    }
  };

  const handleMouseUpOrLeave = () => {
    isInteracting.current = false;
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
    isInteracting.current = true;
    handleInteraction(e);
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (isInteracting.current) {
      handleInteraction(e);
    }
  };

  // Quick reset to (0,0) center
  const handleRecenter = () => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    setPan({ x: rect.width / 2, y: rect.height / 2 });
  };

  if (isMinimized) {
    return (
      <button
        onClick={() => setIsMinimized(false)}
        className={`absolute top-6 right-6 w-11 h-11 rounded-xl flex items-center justify-center transition-all duration-300 shadow-xl cursor-pointer hover:scale-105 active:scale-95 border z-20 backdrop-blur-xl ${
          isDarkTheme 
            ? 'bg-slate-900/80 hover:bg-slate-800 text-slate-300 border-slate-800' 
            : 'bg-white/90 hover:bg-slate-50 text-slate-600 border-slate-200'
        }`}
        title="Show Minimap"
      >
        <Map className="w-5 h-5" />
      </button>
    );
  }

  return (
    <div 
      className={`absolute top-6 right-6 p-3 rounded-[20px] shadow-2xl transition-all duration-300 border z-20 backdrop-blur-xl w-[224px] pointer-events-auto ${
        isDarkTheme 
          ? 'bg-slate-900/85 border-slate-800 text-white' 
          : 'bg-white/95 border-slate-200 text-slate-800'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 select-none">
          <Compass className="w-3.5 h-3.5 text-indigo-400 animate-pulse" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Mini-Map view</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleRecenter}
            className={`p-1 rounded-md text-[9px] font-extrabold tracking-wide cursor-pointer transition-colors ${
              isDarkTheme ? 'hover:bg-slate-800 text-slate-400 hover:text-white' : 'hover:bg-slate-100 text-slate-500 hover:text-slate-800'
            }`}
            title="Recenter Camera to Canvas Origin"
          >
            RECENTER
          </button>
          <button
            onClick={() => setIsMinimized(true)}
            className={`p-1 rounded-md cursor-pointer transition-colors ${
              isDarkTheme ? 'hover:bg-slate-800 text-slate-400 hover:text-white' : 'hover:bg-slate-100 text-slate-500 hover:text-slate-800'
            }`}
            title="Minimize Minimap"
          >
            <Minimize2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Canvas mapping layout */}
      <div className="relative rounded-xl overflow-hidden border border-slate-950/10">
        <canvas
          ref={mapCanvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUpOrLeave}
          onMouseLeave={handleMouseUpOrLeave}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleMouseUpOrLeave}
          className="block cursor-pointer"
        />
      </div>

      {/* Footer Info */}
      <div className="flex items-center justify-between mt-2 px-0.5 text-[9px] font-mono font-bold text-slate-500 select-none">
        <span>Zoom: {Math.round(zoom * 100)}%</span>
        <span>Items: {elements.filter(el => (el.page || 0) === currentPage).length}</span>
      </div>
    </div>
  );
};
