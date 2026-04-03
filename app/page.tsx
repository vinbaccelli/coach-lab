'use client';

import VideoPlayer from './VideoPlayer';
import AnnotationCanvas from './AnnotationCanvas';
import ScreenRecorder from './ScreenRecorder';

const CoachLab = () => {
  return (
    <div className="coach-lab">
      <header className="header">
        <h1>Coach Lab v1</h1>
      </header>
      <div className="layout">
        <aside className="sidebar">
          <nav>
            <ul>
              <li>Home</li>
              <li>About</li>
              <li>Contact</li>
            </ul>
          </nav>
        </aside>
        <main className="canvas-area">
          <VideoPlayer />
          <AnnotationCanvas />
          <ScreenRecorder />
        </main>
        <div className="export-modal">
          <h2>Export Options</h2>
          <button>Export</button>
        </div>
      </div>
    </div>
  );
};

export default CoachLab;