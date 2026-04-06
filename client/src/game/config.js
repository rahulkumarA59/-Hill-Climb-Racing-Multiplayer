import Phaser from 'phaser';
import GameScene from './scenes/GameScene';
import LEVEL_CONFIGS from './levels/LevelConfig';

export function createGameConfig(parentElement, level, players, socket, myId) {
  // Gravity is set per-level from LevelConfig.
  // Level 1 = 1.0 (forgiving), Level 2 = 1.2, Level 3 = 1.5 (punishing)
  const levelGravity = LEVEL_CONFIGS[level]?.gravity || 1.0;

  return {
    type: Phaser.AUTO,
    parent: parentElement,
    width: 1280,
    height: 720,
    backgroundColor: '#0a1628',
    transparent: false,
    physics: {
      default: 'matter',
      matter: {
        gravity: { x: 0, y: levelGravity },
        debug: false,
        enableSleep: false
      }
    },
    scene: [GameScene],
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: 1280,
      height: 720
    },
    render: {
      pixelArt: false,
      antialias: true,
      antialiasGL: true
    },
    callbacks: {
      preBoot: (game) => {
        game.registry.set('level', level);
        game.registry.set('players', players);
        game.registry.set('socket', socket);
        game.registry.set('myId', myId);
      }
    }
  };
}
