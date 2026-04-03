'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Camera, Download } from 'lucide-react';
import VideoPlayer from './VideoPlayer';
import CanvasOverlay from './CanvasOverlay';
import ToolPalette from './ToolPalette';
import ScreenRecorder from './ScreenRecorder';
import ExportModal from './ExportModal';

const App = () => {
    const [activeTool, setActiveTool] = useState(null);
    const [drawingOptions, setDrawingOptions] = useState({});
    const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });
    const [showExport, setShowExport] = useState(false);
    const [sidebarTab, setSidebarTab] = useState('tools');

    // Keyboard shortcuts for undo/redo
    useEffect(() => {
        const handleKeyDown = (event) => {
            if (event.ctrlKey && event.key === 'z') {
                // Undo action
            } else if (event.ctrlKey && event.key === 'y') {
                // Redo action
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, []);

    // Resize observer for responsive sizing
    const canvasRef = useRef();
    useEffect(() => {
        const resizeObserver = new ResizeObserver(() => {
            if (canvasRef.current) {
                // Update canvas size based on parent
                setCanvasSize({ width: canvasRef.current.clientWidth, height: canvasRef.current.clientHeight });
            }
        });
        if (canvasRef.current) {
            resizeObserver.observe(canvasRef.current);
        }
        return () => {
            if (canvasRef.current) {
                resizeObserver.unobserve(canvasRef.current);
            }
        };
    }, [canvasRef]);

    return (
        <div className="app">
            <header className="app-header">
                <h1>Coach Lab</h1>
                <Camera />
                <Download />
            </header>
            <aside className="sidebar">
                <ToolPalette 
                    activeTool={activeTool} 
                    setActiveTool={setActiveTool} 
                    setActiveTab={setSidebarTab} 
                />
            </aside>
            <main className="canvas-area" ref={canvasRef}>
                <VideoPlayer />
                <CanvasOverlay 
                    size={canvasSize} 
                    drawingOptions={drawingOptions} 
                />
            </main>
            <ExportModal 
                show={showExport} 
                onRequestClose={() => setShowExport(false)} 
            />
        </div>
    );
};

export default App;