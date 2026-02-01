# 使用官方 Arch Linux 鏡像
FROM archlinux:latest

# basic package
RUN pacman -Syu --noconfirm &&\
    pacman -S --noconfirm git python-pip nodejs npm &&\
    pip install uv --break-system-packages

# opencode
RUN curl -fsSL https://opencode.ai/install | bash
ENV PATH=/root/.opencode/bin:$PATH
# COPY opencode_cfg /root/.config/opencode

# opencode monitor
RUN git clone https://github.com/Shlomob/ocmonitor-share.git ocmonitor &&\
    cd ocmonitor &&\
    uv pip install --no-cache-dir -r requirements.txt --system --break-system-packages && \
    uv pip install -e . --system --break-system-packages && \
    echo "alias oclive='ocmonitor live ~/.local/share/opencode/storage/message'" >> ~/.bashrc

WORKDIR /opencode_web
# backend
COPY backend /opencode_web/backend
RUN uv pip install --no-cache-dir --break-system-packages --system -r backend/requirements.txt
# frontend
COPY frontend /opencode_web/frontend
RUN cd /opencode_web/frontend && npm install
WORKDIR /app


ENTRYPOINT ["bash", "-c", "python3 /opencode_web/backend/server.py & cd /opencode_web/frontend && npx vite --host 0.0.0.0 --port 8080"]