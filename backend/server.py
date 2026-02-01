import os
import pty
import fcntl
import termios
import struct
import subprocess
import asyncio
import json
from fastapi import FastAPI, WebSocket, HTTPException, Body
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

app = FastAPI()

# 跨域設定，確保前端 Port 2200 能存取 2201
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- 檔案讀寫核心 (保留用於編輯器儲存) ---

@app.get("/api/file/content")
async def get_file_content(path: str):
    """讀取檔案內容"""
    try:
        if not os.path.exists(path):
            raise HTTPException(status_code=404, detail="File not found")
        with open(path, "r", encoding="utf-8") as f:
            return {"content": f.read()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/file/save")
async def save_file(path: str = Body(...), content: str = Body(...)):
    """寫入/儲存檔案"""
    try:
        # 確保父目錄存在
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
        return {"status": "success", "message": f"Saved to {path}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- Terminal WebSocket (支援 Resize) ---

@app.websocket("/ws/terminal")
async def terminal_websocket(websocket: WebSocket):
    await websocket.accept()
    
    # 建立 Pseudo-terminal (PTY)
    master_fd, slave_fd = pty.openpty()
    
    # 啟動 Bash
    # preexec_fn=os.setsid 確保 shell 在獨立的 session 執行，方便清理
    p = subprocess.Popen(
        ["/bin/bash"],
        preexec_fn=os.setsid,
        stdin=slave_fd, stdout=slave_fd, stderr=slave_fd,
        env={**os.environ, "TERM": "xterm-256color"}
    )

    # 將 master_fd 設為非阻塞模式
    flags = fcntl.fcntl(master_fd, fcntl.F_GETFL)
    fcntl.fcntl(master_fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)

    async def pty_to_ws():
        """將 PTY 的輸出傳送到 WebSocket"""
        try:
            while True:
                await asyncio.sleep(0.01)
                try:
                    output = os.read(master_fd, 4096)
                    if output:
                        await websocket.send_bytes(output)
                except (BlockingIOError, OSError):
                    continue
        except: pass

    async def ws_to_pty():
        """將 WebSocket 的輸入傳送到 PTY"""
        try:
            while True:
                msg = await websocket.receive()
                if "bytes" in msg:
                    os.write(master_fd, msg["bytes"])
                elif "text" in msg:
                    data = json.loads(msg["text"])
                    if data.get("type") == "resize":
                        # 處理終端機縮放
                        winsize = struct.pack("HHHH", int(data['rows']), int(data['cols']), 0, 0)
                        fcntl.ioctl(master_fd, termios.TIOCSWINSZ, winsize)
        except: pass

    # 同時跑讀與寫兩個 Task
    tasks = [asyncio.create_task(pty_to_ws()), asyncio.create_task(ws_to_pty())]
    try:
        await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    finally:
        p.terminate()
        try:
            os.close(master_fd)
            os.close(slave_fd)
        except: pass

if __name__ == "__main__":
    # 容器內監聽 8081，對外映射為 2201
    uvicorn.run(app, host="0.0.0.0", port=8081)