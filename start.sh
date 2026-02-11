#!/bin/bash
# ==================================================
# Claw Dashboard — 一行啟動腳本
# Usage: ./start.sh
# ==================================================

set -e
cd "$(dirname "$0")"

echo ""
echo "🚀 Claw Dashboard 啟動中..."
echo "=================================================="

# 安裝 Backend 依賴（只在需要時）
if [ ! -d "backend/node_modules" ]; then
  echo "📦 安裝 Backend 依賴..."
  (cd backend && npm install)
fi

# 安裝 Frontend 依賴（只在需要時）
if [ ! -d "frontend/node_modules" ]; then
  echo "📦 安裝 Frontend 依賴..."
  (cd frontend && npm install)
fi

# 確保 backend .env 存在
if [ ! -f "backend/.env" ]; then
  cp backend/.env.example backend/.env
  echo "📝 已建立 backend/.env"
fi

# 啟動 Backend
echo "⚡ 啟動 Backend (port 3001)..."
(cd backend && node server.js) &
BACKEND_PID=$!

# 等 backend 準備好
sleep 1

# 啟動 Frontend
echo "⚡ 啟動 Frontend (port 5173)..."
(cd frontend && npx vite --open) &
FRONTEND_PID=$!

echo ""
echo "✅ Dashboard 啟動完成！"
echo "   🌐 Frontend: http://localhost:5173"
echo "   🔌 Backend:  http://localhost:3001"
echo ""
echo "   按 Ctrl+C 停止所有服務"
echo "=================================================="

# Ctrl+C 同時關閉兩個 process
cleanup() {
  echo ""
  echo "🛑 停止服務..."
  kill $BACKEND_PID $FRONTEND_PID 2>/dev/null
  wait $BACKEND_PID $FRONTEND_PID 2>/dev/null
  echo "👋 已停止"
  exit 0
}
trap cleanup INT TERM

wait
