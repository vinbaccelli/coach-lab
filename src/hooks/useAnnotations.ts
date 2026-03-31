import create from 'zustand';

type Annotation = { x: number; y: number; color: string; thickness: number; opacity: number; tool: string; };

type State = {
    undoStack: Annotation[];
    redoStack: Annotation[];
    annotationHistory: { [frame: number]: Annotation[] };
    selectedTool: string;
    selectedColor: string;
    lineThickness: number;
    opacity: number;
    addAnnotation: (frame: number, annotation: Annotation) => void;
    undo: () => void;
    redo: () => void;
    setSelectedTool: (tool: string) => void;
    setColor: (color: string) => void;
    setThickness: (thickness: number) => void;
    setOpacity: (opacity: number) => void;
};

const useAnnotations = create<State>((set) => ({
    undoStack: [],
    redoStack: [],
    annotationHistory: {},
    selectedTool: 'brush',
    selectedColor: '#000000',
    lineThickness: 2,
    opacity: 1,
    addAnnotation: (frame, annotation) => set((state) => {
        const historyForFrame = state.annotationHistory[frame] || [];
        return {
            annotationHistory: {
                ...state.annotationHistory,
                [frame]: [...historyForFrame, annotation],
            },
            undoStack: [...state.undoStack, annotation],
            redoStack: [] // Clear redo stack on new action
        };
    }),
    undo: () => set((state) => {
        const lastAction = state.undoStack.pop();
        if (lastAction) {
            return {
                undoStack: state.undoStack,
                redoStack: [...state.redoStack, lastAction]
            };
        }
        return state;
    }),
    redo: () => set((state) => {
        const lastRedoAction = state.redoStack.pop();
        if (lastRedoAction) {
            return {
                redoStack: state.redoStack,
                undoStack: [...state.undoStack, lastRedoAction]
            };
        }
        return state;
    }),
    setSelectedTool: (tool) => set({ selectedTool: tool }),
    setColor: (color) => set({ selectedColor: color }),
    setThickness: (thickness) => set({ lineThickness: thickness }),
    setOpacity: (opacity) => set({ opacity: opacity }),
}));

export default useAnnotations;