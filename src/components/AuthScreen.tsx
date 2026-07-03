import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Layers, Mail, Lock, User, Sparkles, ArrowRight, AlertCircle, ShieldCheck } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export const AuthScreen: React.FC = () => {
  const { signUp, logIn, logInAsGuest } = useAuth();
  const [activeMode, setActiveMode] = useState<'login' | 'signup' | 'guest'>('guest');
  
  // Fields state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  
  // UX states
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setLoading(true);

    try {
      if (activeMode === 'guest') {
        const trimmed = name.trim();
        if (!trimmed) {
          setErrorMsg("Please enter a nickname/display name.");
          setLoading(false);
          return;
        }
        await logInAsGuest(trimmed);
      } else if (activeMode === 'login') {
        if (!email.trim() || !password) {
          setErrorMsg("Email and password fields are required.");
          setLoading(false);
          return;
        }
        await logIn(email.trim(), password);
      } else if (activeMode === 'signup') {
        const trimmedName = name.trim();
        if (!trimmedName || !email.trim() || !password) {
          setErrorMsg("All fields are required for sign up.");
          setLoading(false);
          return;
        }
        await signUp(email.trim(), password, trimmedName);
      }
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || "An authentication error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 relative overflow-hidden font-sans selection:bg-indigo-500/30 selection:text-indigo-200">
      
      {/* Premium Ambient Background Orbs */}
      <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-indigo-600/10 rounded-full blur-[120px] pointer-events-none animate-pulse duration-10000"></div>
      <div className="absolute bottom-0 right-1/4 w-[600px] h-[600px] bg-cyan-500/10 rounded-full blur-[150px] pointer-events-none animate-pulse duration-7000"></div>
      <div className="absolute top-1/3 right-1/3 w-[300px] h-[300px] bg-purple-600/10 rounded-full blur-[90px] pointer-events-none animate-pulse duration-5000"></div>

      {/* Grid Pattern overlay for tech aesthetic */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#0f172a_1px,transparent_1px),linear-gradient(to_bottom,#0f172a_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)] opacity-70 pointer-events-none"></div>

      {/* Main card box with high-end glassmorphism & thin borders */}
      <motion.div 
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-md rounded-[24px] bg-slate-900/45 backdrop-blur-2xl border border-slate-800/80 p-8 md:p-10 relative shadow-2xl shadow-black/50 z-10 flex flex-col"
      >
        {/* Colorful accent line at the top */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[80%] h-[2px] bg-gradient-to-r from-transparent via-indigo-500 to-transparent"></div>

        {/* Title branding header */}
        <div className="flex flex-col items-center text-center mb-8">
          <motion.div 
            whileHover={{ scale: 1.05, rotate: 5 }}
            className="w-13 h-13 bg-gradient-to-tr from-indigo-600 via-purple-600 to-cyan-500 rounded-2xl flex items-center justify-center text-white shadow-xl shadow-indigo-900/30 mb-4 cursor-pointer"
          >
            <Layers className="w-6.5 h-6.5" />
          </motion.div>
          <h2 className="font-display font-bold text-3xl text-white tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-300 bg-clip-text text-transparent">
            CanvasSync
          </h2>
          <p className="text-slate-400 text-xs mt-2 leading-relaxed max-w-xs">
            A real-time visual sandbox for planning, wireframing, and vector drawings.
          </p>
        </div>

        {/* Tab switches */}
        <div className="flex bg-slate-950/80 rounded-2xl p-1 mb-6 border border-slate-800/60 gap-1 shadow-inner relative">
          {(['guest', 'login', 'signup'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => { setActiveMode(mode); setErrorMsg(null); }}
              className={`flex-1 py-2 text-xs font-semibold rounded-xl transition-all duration-200 capitalize relative ${
                activeMode === mode 
                  ? 'text-white' 
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {activeMode === mode && (
                <motion.div 
                  layoutId="activeTabIndicator"
                  className="absolute inset-0 bg-slate-800/80 border border-slate-700/50 rounded-xl"
                  transition={{ type: "spring", stiffness: 350, damping: 30 }}
                />
              )}
              <span className="relative z-10">
                {mode === 'guest' ? 'Guest Join' : mode === 'login' ? 'Log In' : 'Sign Up'}
              </span>
            </button>
          ))}
        </div>

        {/* Display Alert Message */}
        <AnimatePresence mode="wait">
          {errorMsg && (
            <motion.div 
              initial={{ opacity: 0, height: 0, y: -10 }}
              animate={{ opacity: 1, height: 'auto', y: 0 }}
              exit={{ opacity: 0, height: 0, y: -10 }}
              className="mb-5 bg-red-950/40 border border-red-800/50 p-3.5 rounded-2xl flex items-start gap-2.5 text-xs text-red-200 leading-normal overflow-hidden"
            >
              <AlertCircle className="w-4.5 h-4.5 shrink-0 mt-0.5 text-red-400" />
              <span>{errorMsg}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Auth form input controllers */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <AnimatePresence mode="wait">
            {/* Nickname Field */}
            {(activeMode === 'signup' || activeMode === 'guest') && (
              <motion.div
                key="name-field"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
              >
                <label className="block text-[10px] font-bold tracking-wider text-slate-400 uppercase mb-1.5 ml-1">
                  {activeMode === 'guest' ? 'Your Nickname' : 'Display Name'}
                </label>
                <div className="relative flex items-center group">
                  <User className="w-4.5 h-4.5 text-slate-500 absolute left-4 transition-colors group-focus-within:text-indigo-400" />
                  <input
                    type="text"
                    placeholder={activeMode === 'guest' ? 'e.g. Alice' : 'e.g. Alice Cooper'}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full bg-slate-950/60 border border-slate-800/80 focus:border-indigo-500/80 focus:bg-slate-950 rounded-2xl pl-11 pr-4 py-3 text-sm text-white transition-all outline-none focus:ring-4 focus:ring-indigo-500/10 placeholder-slate-600"
                    required
                  />
                </div>
              </motion.div>
            )}

            {/* Email Field */}
            {activeMode !== 'guest' && (
              <motion.div
                key="email-field"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="space-y-4"
              >
                <div>
                  <label className="block text-[10px] font-bold tracking-wider text-slate-400 uppercase mb-1.5 ml-1">
                    Email Address
                  </label>
                  <div className="relative flex items-center group">
                    <Mail className="w-4.5 h-4.5 text-slate-500 absolute left-4 transition-colors group-focus-within:text-indigo-400" />
                    <input
                      type="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full bg-slate-950/60 border border-slate-800/80 focus:border-indigo-500/80 focus:bg-slate-950 rounded-2xl pl-11 pr-4 py-3 text-sm text-white transition-all outline-none focus:ring-4 focus:ring-indigo-500/10 placeholder-slate-600"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold tracking-wider text-slate-400 uppercase mb-1.5 ml-1">
                    Secure Password
                  </label>
                  <div className="relative flex items-center group">
                    <Lock className="w-4.5 h-4.5 text-slate-500 absolute left-4 transition-colors group-focus-within:text-indigo-400" />
                    <input
                      type="password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full bg-slate-950/60 border border-slate-800/80 focus:border-indigo-500/80 focus:bg-slate-950 rounded-2xl pl-11 pr-4 py-3 text-sm text-white transition-all outline-none focus:ring-4 focus:ring-indigo-500/10 placeholder-slate-600"
                      required
                    />
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Call to action button with modern gradient and lift */}
          <motion.button
            whileHover={{ scale: 1.015 }}
            whileTap={{ scale: 0.985 }}
            type="submit"
            disabled={loading}
            className="w-full mt-6 bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-600 hover:from-indigo-500 hover:to-purple-500 text-white font-semibold py-3 px-4 rounded-2xl shadow-xl shadow-indigo-950/40 active:translate-y-0 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed border border-indigo-400/20"
          >
            <span className="text-sm font-semibold tracking-wide">
              {loading ? 'Connecting Securely...' : (
                activeMode === 'guest' ? 'Launch Guest Sandbox' : (
                  activeMode === 'login' ? 'Access Board' : 'Create SaaS Account'
                )
              )}
            </span>
            {!loading && <ArrowRight className="w-4 h-4" />}
          </motion.button>
        </form>

        {activeMode === 'guest' && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mt-6 flex items-start gap-2.5 bg-indigo-950/40 border border-indigo-900/30 p-3.5 rounded-2xl text-[11px] text-indigo-300 leading-relaxed"
          >
            <Sparkles className="w-4 h-4 shrink-0 text-indigo-400 mt-0.5" />
            <span>
              <strong>Immediate Sandbox Access:</strong> Jump directly into public/shared workspace sync. Recommended for speedy reviews!
            </span>
          </motion.div>
        )}
      </motion.div>
    </div>
  );
};
