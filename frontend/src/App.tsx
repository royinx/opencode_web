import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X } from 'lucide-react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { Mosaic, MosaicWindow, MosaicNode, MosaicPath } from 'react-mosaic-component';

import 'xterm/css/xterm.css';
import 'react-mosaic-component/react-mosaic-component.css';
import './App.css';

type ViewId = string;

const HOST = window.location.hostname;
// 讀取環境變數，如果沒設定則 fallback 回 2201
const WS_PORT = import.meta.env.VITE_TERMINAL_WS_PORT || '2201';
const WS_BASE = `ws://${HOST}:${WS_PORT}`;

function myCloneDeep(obj: any): any {
  return JSON.parse(JSON.stringify(obj));
}

// --- Terminal 組件 (新增快捷鍵轉發邏輯) ---
const TerminalComponent = ({ 
  initialCommand, 
  onNewTerminalRequested 
}: { 
  initialCommand?: string, 
  onNewTerminalRequested: () => void 
}) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!terminalRef.current) return;
    
    const term = new Terminal({
      theme: { background: '#1e1e1e', foreground: '#ffffff' },
      cursorBlink: true,
      convertEol: true,
      fontSize: 13,
      fontFamily: '"Cascadia Code", monospace'
    });
    
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    xtermRef.current = term;

    // --- 關鍵修正：攔截自定義快捷鍵 ---
    term.attachCustomKeyEventHandler((arg) => {
      // 偵測 Ctrl (或 Meta) + Shift + X
      if (arg.ctrlKey && arg.shiftKey && arg.code === 'KeyX' && arg.type === 'keydown') {
        onNewTerminalRequested();
        return false; // 返回 false 代表不把這個按鍵傳給後端 Bash
      }
      return true;
    });

    const timer = setTimeout(() => {
      term.open(terminalRef.current!);
      fitAddon.fit();

      const ws = new WebSocket(`${WS_BASE}/ws/terminal`);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
        if (initialCommand) {
          ws.send(new TextEncoder().encode(initialCommand + '\r'));
        }
      };

      ws.onmessage = async (ev) => {
        const data = await (ev.data instanceof Blob ? ev.data.arrayBuffer() : ev.data);
        term.write(new Uint8Array(data));
      };

      term.onData(data => ws.readyState === 1 && ws.send(new TextEncoder().encode(data)));
      term.onResize(size => ws.readyState === 1 && ws.send(JSON.stringify({ type: 'resize', cols: size.cols, rows: size.rows })));
    }, 200);

    const resizer = new ResizeObserver(() => {
      if (terminalRef.current?.offsetWidth && xtermRef.current) {
        try { fitAddon.fit(); } catch (e) {}
      }
    });
    resizer.observe(terminalRef.current);

    return () => {
      clearTimeout(timer);
      resizer.disconnect();
      if (wsRef.current) wsRef.current.close();
      term.dispose();
    };
  }, [initialCommand, onNewTerminalRequested]);

  return <div ref={terminalRef} style={{ height: '100%', width: '100%', background: '#1e1e1e' }} />;
};

// --- 主應用 ---
export default function App() {
  const [layout, setLayout] = useState<MosaicNode<ViewId> | null>({
    direction: 'row',
    first: 'terminal_opencode',
    second: 'terminal_oclive',
    splitPercentage: 65,
  });

  // 使用 useCallback 確保函式引用穩定，避免 Terminal 重複渲染
  const handleAddTerminal = useCallback(() => {
    const newId = `terminal_extra_${Date.now()}`;
    setLayout((prevLayout) => {
      if (!prevLayout) return newId;
      return { 
        direction: 'row', 
        first: prevLayout, 
        second: newId, 
        splitPercentage: 70 
      };
    });
  }, []);

  const closeWindow = (path: MosaicPath) => {
    if (!layout) return;
    if (path.length === 0) {
      setLayout(null);
      return;
    }
    const newLayout = myCloneDeep(layout);
    const updateTree = (node: any, currentPath: MosaicPath): any => {
      if (currentPath.length === 1) {
        return currentPath[0] === 'first' ? node.second : node.first;
      }
      const step = currentPath[0];
      node[step] = updateTree(node[step], currentPath.slice(1));
      return node;
    };
    setLayout(updateTree(newLayout, path));
  };

  return (
    <div style={{ height: '100vh', width: '100vw', background: '#000' }}>
      <Mosaic<ViewId>
        renderTile={(id, path) => (
          <MosaicWindow<ViewId>
            path={path}
            title={id.includes('opencode') ? 'Opencode' : id.includes('oclive') ? 'Live Preview' : 'Terminal'}
            toolbarControls={[
              <button 
                key="c" 
                onClick={() => closeWindow(path)} 
                style={{background:'none', border:'none', color:'#555', cursor:'pointer'}}
              >
                <X size={14}/>
              </button>
            ]}
          >
            <TerminalComponent 
              onNewTerminalRequested={handleAddTerminal}
              initialCommand={
                id === 'terminal_opencode' ? 'opencode' : 
                id === 'terminal_oclive' ? 'oclive && clear && echo "This tab is reserve for live monitoring \n\nPlease start conversation in opencode\n\nthen run:\n\n    $ oclive\n"' : 
                undefined
              } 
            />
          </MosaicWindow>
        )}
        value={layout}
        onChange={setLayout}
      />
    </div>
  );
}