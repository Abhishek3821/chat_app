import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import NavRail from './NavRail';
import TopBar from './TopBar';
import MobileNav from './MobileNav';
import ModalHost from '../modals/ModalHost';
import CallOverlay from '../overlays/CallOverlay';
import ErrorBoundary from '../ErrorBoundary';
import { useChat } from '../../store/useChat';
import { useSocket } from '../../hooks/useSocket';

export default function AppLayout() {
  const loadChats = useChat((s) => s.loadChats);
  const { pathname } = useLocation();
  useSocket();

  useEffect(() => {
    loadChats();
  }, [loadChats]);

  // On the chat page the conversation region handles its own scrolling;
  // other pages get a scrollable content area.
  const isChat = pathname === '/';

  return (
    <div className="relative flex h-[100dvh] overflow-hidden bg-mesh-light dark:bg-mesh-dark">
      <div className="pointer-events-none absolute inset-0 bg-[rgb(var(--app-bg))]/60" />
      <div className="relative z-10 flex h-full w-full">
        <NavRail />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          <main className={isChat ? 'min-h-0 flex-1' : 'scrollbar-thin min-h-0 flex-1 overflow-y-auto pb-20 md:pb-0'}>
            {/* Page-level boundary: a render error in one screen keeps the nav/topbar
                alive and resets when you navigate (resetKey = pathname). */}
            <ErrorBoundary resetKey={pathname}>
              <Outlet />
            </ErrorBoundary>
          </main>
        </div>
      </div>
      <MobileNav />
      <ModalHost />
      <CallOverlay />
    </div>
  );
}
