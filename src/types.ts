export type ToolType = 'select' | 'pencil' | 'line' | 'rectangle' | 'circle' | 'text' | 'sticky' | 'eraser' | 'laser' | 'hand';

export interface Point {
  x: number;
  y: number;
}

export interface Board {
  id: string;
  title: string;
  ownerId: string;
  ownerName: string;
  createdAt: number;
  updatedAt: number;
  collaborators?: string[]; // user IDs or emails
  permissions?: { [userId: string]: 'owner' | 'editor' | 'viewer' };
  pagesCount?: number;
  currentPage?: number;
  tags?: string[]; // Content tags for fuzzy search
}

export interface BaseElement {
  id: string;
  type: Exclude<ToolType, 'select' | 'laser'>;
  color: string;
  strokeWidth: number;
  opacity: number;
  createdAt: number;
  updatedBy: string;
  userName: string;
  page?: number; // supporting multiple pages (Bonus D)
}

export interface PencilElement extends BaseElement {
  type: 'pencil';
  points: Point[];
}

export interface LineElement extends BaseElement {
  type: 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface RectangleElement extends BaseElement {
  type: 'rectangle';
  x: number;
  y: number;
  width: number;
  height: number;
  fillColor?: string;
}

export interface CircleElement extends BaseElement {
  type: 'circle';
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  fillColor?: string;
}

export interface TextElement extends BaseElement {
  type: 'text';
  x: number;
  y: number;
  text: string;
  fontSize: number;
  fontFamily: string;
}

export interface StickyElement extends BaseElement {
  type: 'sticky';
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  bgColor: string; // e.g. yellow, blue, pink
}

export interface ImageElement extends BaseElement {
  type: 'eraser'; // Wait, let's keep image separate
  x: number;
  y: number;
  width: number;
  height: number;
  url: string;
}

// We can group all drawable elements
export type BoardElement = 
  | PencilElement 
  | LineElement 
  | RectangleElement 
  | CircleElement 
  | TextElement 
  | StickyElement;

export interface CursorPresence {
  userId: string;
  userName: string;
  userColor: string;
  x: number;
  y: number;
  lastActive: number;
  laserPoints?: Point[]; // Live laser pointer path (if any)
}

export interface ChatMessage {
  id: string;
  userId: string;
  userName: string;
  userColor: string;
  text: string;
  createdAt: number;
}

export interface BoardHistoryItem {
  id: string;
  elementId: string;
  action: 'create' | 'update' | 'delete';
  elementData: any;
  userId: string;
  userName: string;
  createdAt: number;
}
