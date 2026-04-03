'use client';

import { useStore, Tool } from '@/lib/store';

const TOOLS: { id: Tool; label: string; icon: string }[] = [
  { id: 'select', label: 'Select', icon: '↖' },
  { id: 'freedraw', label: 'Free Draw', icon: '✏️' },
  { id: 'line', label: 'Line', icon: '╱' },
  { id: 'angle', label: 'Angle', icon: '∠' },
  { id: 'circle', label: 'Circle', icon: '○' },
  { id: 'rect', label: 'Rectangle', icon: '□' },
  { id: 'text', label: 'Text', icon: 'T' },
  { id: 'eraser', label: 'Eraser', icon: '⌫' },
];

export default function Toolbar() {
  const { activeTool, setActiveTool, settings, setSettings } = useStore();

  const dashArrayPreview = (style: 'solid' | 'dashed' | 'dotted') => {
    if (style === 'dashed') return '- - -';
    if (style === 'dotted') return '· · ·';
    return '——';
  };

  return (
    <div className="frosted-glass rounded-2xl p-3 flex flex-col gap-3 shadow-xl w-56">
      <div className="grid grid-cols-4 gap-1">
        {TOOLS.map((tool) => (
          <button
            key={tool.id}
            onClick={() => setActiveTool(tool.id)}
            title={tool.label}
            className={`tool-btn text-sm font-medium ${activeTool === tool.id ? 'active' : 'bg-white/50 text-gray-700'}`}
          >
            {tool.icon}
          </button>
        ))}
      </div>

      <div className="h-px bg-gray-200" />

      <div>
        <label className="text-xs font-medium text-gray-500 block mb-1">Stroke</label>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={settings.strokeColor}
            onChange={(e) => setSettings({ strokeColor: e.target.value })}
            className="w-8 h-8 rounded-lg border-0 cursor-pointer"
          />
          <input
            type="text"
            value={settings.strokeColor}
            onChange={(e) => setSettings({ strokeColor: e.target.value })}
            className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1 font-mono bg-white/50"
            maxLength={7}
          />
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-gray-500 block mb-1">Fill</label>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={settings.fillColor === 'transparent' ? '#ffffff' : settings.fillColor}
            onChange={(e) => setSettings({ fillColor: e.target.value })}
            className="w-8 h-8 rounded-lg border-0 cursor-pointer"
          />
          <button
            onClick={() => setSettings({ fillColor: settings.fillColor === 'transparent' ? '#ffffff' : 'transparent' })}
            className={`flex-1 text-xs border rounded-lg px-2 py-1 ${settings.fillColor === 'transparent' ? 'bg-white border-gray-300 text-gray-500' : 'bg-white/50 border-gray-200 text-gray-700'}`}
          >
            {settings.fillColor === 'transparent' ? 'No fill' : 'Filled'}
          </button>
        </div>
      </div>

      <div>
        <div className="flex justify-between mb-1">
          <label className="text-xs font-medium text-gray-500">Thickness</label>
          <span className="text-xs text-gray-500">{settings.lineThickness}px</span>
        </div>
        <input
          type="range"
          min={1}
          max={20}
          value={settings.lineThickness}
          onChange={(e) => setSettings({ lineThickness: parseInt(e.target.value) })}
          className="w-full"
        />
      </div>

      <div>
        <div className="flex justify-between mb-1">
          <label className="text-xs font-medium text-gray-500">Opacity</label>
          <span className="text-xs text-gray-500">{settings.opacity}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={settings.opacity}
          onChange={(e) => setSettings({ opacity: parseInt(e.target.value) })}
          className="w-full"
        />
      </div>

      <div>
        <label className="text-xs font-medium text-gray-500 block mb-1">Line style</label>
        <div className="grid grid-cols-3 gap-1">
          {(['solid', 'dashed', 'dotted'] as const).map((style) => (
            <button
              key={style}
              onClick={() => setSettings({ lineStyle: style })}
              className={`py-1 rounded-lg text-xs transition-colors ${
                settings.lineStyle === style ? 'bg-[#007AFF] text-white' : 'bg-white/50 border border-gray-200 text-gray-600'
              }`}
            >
              {dashArrayPreview(style)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
