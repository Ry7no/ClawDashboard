import React from 'react';

const FoxAvatar = ({ status }) => {
  const isThinking = status.toLowerCase() === 'thinking';
  const isActing = status.toLowerCase() === 'acting';

  const base = import.meta.env.BASE_URL || '/';
  const avatarSrc = `${base}avatars/bunny.png`;

  return (
    <div className={`fox-container ${isThinking ? 'thinking' : ''} ${isActing ? 'acting' : ''}`}>
      <div className="fox-avatar-wrapper transparent">
        <img 
          src={avatarSrc}
          alt="Milo Fox" 
          className="fox-image"
        />
      </div>
    </div>
  );
};

export default FoxAvatar;
