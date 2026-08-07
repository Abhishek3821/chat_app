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
import { useWorkspace } from '../../store/useWorkspace';
import { useSocket } from '../../hooks/useSocket';
import { askPermissionOnFirstGesture } from '../../lib/notify';

export default function AppLayout() {
  const loadChats = useChat((s) => s.loadChats);
  const loadWorkspace = useWorkspace((s) => s.load);
  const { pathname } = useLocation();
  const outlet = useOutlet();
  useSocket();

  useEffect(() => {
    loadChats();
    loadWorkspace(); // so nav can surface team-only tools (Business)
  }, [loadChats, loadWorkspace]);

  // Ask for desktop-notification permission on the first interaction after
  // signing in (browsers reject the prompt outside a user gesture).
  useEffect(askPermissionOnFirstGesture, []);

  // On the chat page the conversation region handles its own scrolling;
  // other pages get a scrollable content area.
  const isChat = pathname === '/';

  return (
    /* The same lit-room wash the conversation canvas uses, so panels lift off
       the background on every page rather than only inside a chat. */
    <div className="chat-canvas relative flex h-[100dvh] overflow-hidden">
      <div className="relative z-10 flex h-full w-full">
        <NavRail />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          <main
            className={
              isChat
                ? 'min-h-0 flex-1'
                : // The bottom nav is 68px tall plus the iOS home-indicator inset;
                  // pb-20 alone left the last row under it on notched phones.
                  'scrollbar-thin min-h-0 flex-1 overflow-y-auto pb-[calc(68px+env(safe-area-inset-bottom))] md:pb-0'
            }
          >
            {/* Page-level boundary: a render error in one screen keeps the nav/topbar
                alive and resets when you navigate (resetKey = pathname). The keyed
                motion.div gives each route a clean entrance without a fragile
                mode="wait" that could stall the swap. */}
            <ErrorBoundary resetKey={pathname}>
              <motion.div
                key={pathname}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.16 }}
                // Chat runs full-bleed (it manages its own columns). Every other
                // page gets centred with a ceiling so text lines don't stretch
                // across an ultrawide monitor.
                className={isChat ? 'h-full' : 'mx-auto h-full w-full max-w-screen-2xl'}
              >
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
