import React, { useEffect } from 'react';
import { fabric } from 'fabric';

const AnnotationCanvas = () => {
  const canvasRef = React.useRef(null);

  useEffect(() => {
    const canvas = new fabric.Canvas(canvasRef.current, {
      isDrawingMode: true,
      backgroundColor: 'white',
    });

    // Free Draw
    const enableFreeDraw = () => {
      canvas.isDrawingMode = true;
    };

    // Line Tool
    const drawLine = () => {
      const line = new fabric.Line([50, 100, 200, 200], {
        stroke: 'black',
        strokeWidth: 2,
      });
      canvas.add(line);
    };

    // Arrow Tool
    const drawArrow = (x1, y1, x2, y2) => {
      const arrow = new fabric.Line([x1, y1, x2, y2], {
        stroke: 'black',
        strokeWidth: 2,
        selectable: false,
      });
      canvas.add(arrow);
    };

    // Shapes
    const drawCircle = () => {
      const circle = new fabric.Circle({
        radius: 50,
        fill: 'red',
        top: 100,
        left: 100,
      });
      canvas.add(circle);
    };

    const drawRectangle = () => {
      const rect = new fabric.Rect({
        top: 150,
        left: 150,
        fill: 'green',
        width: 100,
        height: 50,
      });
      canvas.add(rect);
    };

    const drawEllipse = () => {
      const ellipse = new fabric.Ellipse({
        top: 200,
        left: 200,
        rx: 70,
        ry: 40,
        fill: 'blue',
      });
      canvas.add(ellipse);
    };

    // Measurement Tools
    const measureDistance = (x1, y1, x2, y2) => {
      // Implement distance measurement logic here
    };

    const measureAngle = (x1, y1, x2, y2) => {
      // Implement angle measurement logic here
    };

    // Text Labels
    const addTextLabel = (text) => {
      const textLabel = new fabric.Text(text, {
        left: 100,
        top: 300,
        fontSize: 20,
      });
      canvas.add(textLabel);
    };

    // Eraser
    const eraser = () => {
      canvas.isDrawingMode = true;
      canvas.freeDrawingBrush = new fabric.EraserBrush(canvas);
    };

    // Undo/Redo
    const undoStack = [];
    const redoStack = [];

    const undo = () => {
      // Implement undo logic here
    };

    const redo = () => {
      // Implement redo logic here
    };

    // Annotation Persistence
    const saveAnnotations = () => {
      const json = canvas.toJSON();
      localStorage.setItem('annotations', JSON.stringify(json));
    };

    const loadAnnotations = () => {
      const json = localStorage.getItem('annotations');
      if (json) {
        canvas.loadFromJSON(json, () => canvas.renderAll());
      }
    };

    loadAnnotations();

    // Clean up
    return () => {
      canvas.dispose();
    };
  }, []);

  return <canvas ref={canvasRef} width={800} height={600} />;
};

export default AnnotationCanvas;
