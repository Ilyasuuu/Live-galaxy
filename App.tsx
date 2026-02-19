import React, { useState } from 'react';
import GalaxyScene from './components/GalaxyScene';

export default function App() {
  const [hasStarted, setHasStarted] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);

  const handleStart = async () => {
    try {
      // Prompt for microphone permission early to catch errors
      await navigator.mediaDevices.getUserMedia({ audio: true });
      setHasStarted(true);
    } catch (err) {
      setMicError("Microphone access is required for this experience.");
      console.error("Mic access error:", err);
    }
  };

  return (
    <div className="relative w-screen h-screen bg-[#030308] font-sans text-white overflow-hidden">
      {!hasStarted ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-10 p-4 bg-gradient-to-b from-[#030308] to-black">
          <div className="max-w-xl text-center flex flex-col items-center">
            <h1 
              className="text-5xl md:text-7xl font-bold tracking-tighter mb-6 text-[#FFD54F] drop-shadow-[0_4px_20px_rgba(255,213,79,0.3)] animate-pulse"
              style={{ fontFamily: '"Pixelify Sans", sans-serif' }}
            >
              Sonic Entity
            </h1>
            <p className="text-lg md:text-xl text-gray-300 mb-12 font-light leading-relaxed">
              A vibrant, swirling galaxy of 40,000 glowing particles. <br/>
              Speak to the AI entity. As it replies, its words will echo sharply into the space.
            </p>
            
            {micError ? (
              <div className="bg-red-900/50 border border-red-500 text-red-200 px-6 py-4 rounded-lg mb-8 shadow-lg shadow-red-500/20">
                {micError}
              </div>
            ) : null}

            <button
              onClick={handleStart}
              className="group relative px-8 py-4 bg-[#1a082a] text-[#F8F9FA] rounded-full font-bold text-lg uppercase tracking-widest overflow-hidden transition-all duration-300 hover:bg-[#FFD54F] hover:text-black hover:scale-105 shadow-[0_0_20px_rgba(26,8,42,0.8)] hover:shadow-[0_0_40px_rgba(255,213,79,0.4)] border border-[#2a183a]"
            >
              <span className="relative z-10">Start Experience</span>
              <div className="absolute inset-0 h-full w-full scale-0 rounded-full transition-all duration-300 ease-out group-hover:scale-100 group-hover:bg-white/20 z-0"></div>
            </button>
            <p className="mt-6 text-xs text-gray-500 tracking-wide uppercase">Requires Microphone</p>
          </div>
        </div>
      ) : (
        <GalaxyScene />
      )}
    </div>
  );
}