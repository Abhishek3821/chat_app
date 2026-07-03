import { useEffect } from 'react';
import { useOutlet, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
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
  const outlet = useOutlet();
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
                alive and resets when you navigate (resetKey = pathname). The keyed
                motion.div gives each route a clean entrance without a fragile
                mode="wait" that could stall the swap. */}
            <ErrorBoundary resetKey={pathname}>
              <motion.div key={pathname} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.16 }} className="h-full">
                {outlet}
              </motion.div>
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
