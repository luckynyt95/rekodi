#!/bin/bash
# Download the on-device LLM (run once). Whisper tiny auto-downloads on first transcribe (~39MB).
mkdir -p models
curl -L --retry 3 -o models/qwen2.5-0.5b-instruct-q4_k_m.gguf https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf
