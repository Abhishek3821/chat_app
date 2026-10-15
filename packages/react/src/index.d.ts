import type { CSSProperties, ForwardRefExoticComponent, RefAttributes } from 'react';
export interface ChatKonectUser { id: string; externalId?: string; name: string }
export interface ChatKonectError { code: string; message: string }
export interface ChatKonectHandle {
  navigate(to: string): void;
  refreshToken(): Promise<void> | undefined;
  destroy(): void;
}
export interface ChatKonectProps {
  host: string;
  appId: string;
  getToken?: () => string | { token: string } | Promise<string | { token: string }>;
  token?: string;
  /** Deprecated: renewal is scheduled from the validated JWT expiry. */
  tokenSeconds?: number;
  theme?: 'light' | 'dark' | 'system';
  initialPath?: string;
  /** Change this when your signed-in user changes, to clear the old frame. */
  identityKey?: string | number;
  onReady?: (user: ChatKonectUser) => void;
  onError?: (error: ChatKonectError) => void;
  onConfig?: (config: { app: { appId: string; name: string; features: string[] }; ice: { relay: string }; endpoints: { apiBaseUrl: string; socketUrl: string; embedUrl: string } }) => void;
  onLogout?: () => void;
  onNavigate?: (to: string) => void;
  className?: string;
  style?: CSSProperties;
}
export declare const ChatKonect: ForwardRefExoticComponent<ChatKonectProps & RefAttributes<ChatKonectHandle>>;
export default ChatKonect;
