import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import { createGameConfig } from './config';

export default function PhaserGame({ level, players, socket, myId, onReady }) {
  const gameRef = useRef(null);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Destroy existing game
    if (gameRef.current) {
      gameRef.current.destroy(true);
      gameRef.current = null;
    }

    const config = createGameConfig(containerRef.current, level, players, socket, myId);
    
    // Store start time
    const game = new Phaser.Game(config);
    game.registry.set('startTime', Date.now());
    gameRef.current = game;

    if (onReady) onReady(game);

    return () => {
      if (gameRef.current) {
        gameRef.current.destroy(true);
        gameRef.current = null;
      }
    };
  }, [level, players, socket, myId]);

  return (
    <div 
      ref={containerRef} 
      id="phaser-container"
      style={{ 
        width: '100%', 
        height: '100%',
        position: 'absolute',
        top: 0,
        left: 0
      }} 
    />
  );
}
