import React, { useRef, useState, useEffect } from 'react';
import { compressImage } from '../../core/utils/imageUtils';

interface SignaturePadProps {
  onSave: (signatureDataUrl: string) => void;
  onCancel?: () => void;
  initialSignature?: string | null;
  hideCancel?: boolean;
}

export function SignaturePad({ onSave, onCancel, initialSignature, hideCancel = false }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resizeCanvas = () => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      
      ctx.scale(dpr, dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;

      // Professional bold pen-like stroke
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 4.5;
      
      const isDark = document.documentElement.classList.contains('dark');
      ctx.strokeStyle = isDark ? '#FFFFFF' : '#000000';
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    
    if (initialSignature) {
      const img = new Image();
      img.onload = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width / (window.devicePixelRatio || 1), canvas.height / (window.devicePixelRatio || 1));
      };
      img.src = initialSignature;
    }

    return () => window.removeEventListener('resize', resizeCanvas);
  }, [initialSignature]);

  const getCoordinates = (e: React.MouseEvent | React.TouchEvent | MouseEvent | TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    
    if ('touches' in e) {
      return {
        x: e.touches[0].clientX - rect.left,
        y: e.touches[0].clientY - rect.top,
      };
    }
    return {
      x: (e as any).clientX - rect.left,
      y: (e as any).clientY - rect.top,
    };
  };

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const { x, y } = getCoordinates(e);
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    
    ctx.beginPath();
    ctx.moveTo(x, y);
    lastPointRef.current = { x, y };
    
    setIsDrawing(true);
    setHasDrawn(true);
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    if (!isDrawing || !lastPointRef.current) return;
    const { x, y } = getCoordinates(e);
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    
    const midX = (lastPointRef.current.x + x) / 2;
    const midY = (lastPointRef.current.y + y) / 2;
    
    // Use quadratic curves for incredibly smooth and professional handwriting strokes
    ctx.quadraticCurveTo(lastPointRef.current.x, lastPointRef.current.y, midX, midY);
    ctx.stroke();
    
    // Reset path for the next segment
    ctx.beginPath();
    ctx.moveTo(midX, midY);
    lastPointRef.current = { x, y };
  };

  const stopDrawing = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    lastPointRef.current = null;
  };

  const handleClear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      setHasDrawn(false);
    }
  };

  const getCroppedCanvas = (canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = pixels.data;
    let minX = canvas.width, minY = canvas.height, maxX = 0, maxY = 0;
    
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const alpha = d[(y * canvas.width + x) * 4 + 3];
        if (alpha > 0) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    
    if (maxX < minX || maxY < minY) return canvas; // Empty canvas
    
    // Add padding
    const padding = 20;
    minX = Math.max(0, minX - padding);
    minY = Math.max(0, minY - padding);
    maxX = Math.min(canvas.width, maxX + padding);
    maxY = Math.min(canvas.height, maxY + padding);
    
    const croppedWidth = maxX - minX;
    const croppedHeight = maxY - minY;
    
    const croppedCanvas = document.createElement('canvas');
    croppedCanvas.width = croppedWidth;
    croppedCanvas.height = croppedHeight;
    const croppedCtx = croppedCanvas.getContext('2d');
    if (croppedCtx) {
      croppedCtx.putImageData(ctx.getImageData(minX, minY, croppedWidth, croppedHeight), 0, 0);
    }
    return croppedCanvas;
  };

  const handleSave = () => {
    const canvas = canvasRef.current;
    if (canvas) {
      const croppedCanvas = getCroppedCanvas(canvas);
      
      let finalCanvas = croppedCanvas;
      const MAX_WIDTH = 600;
      if (croppedCanvas.width > MAX_WIDTH) {
        const scale = MAX_WIDTH / croppedCanvas.width;
        finalCanvas = document.createElement('canvas');
        finalCanvas.width = MAX_WIDTH;
        finalCanvas.height = croppedCanvas.height * scale;
        const finalCtx = finalCanvas.getContext('2d');
        if (finalCtx) {
          finalCtx.drawImage(croppedCanvas, 0, 0, finalCanvas.width, finalCanvas.height);
        }
      }
      
      onSave(finalCanvas.toDataURL('image/png'));
    }
  };

  return (
    <div className="flex flex-col space-y-4">
      <div 
        ref={containerRef}
        className="w-full h-48 sm:h-64 border border-neutral-300 dark:border-white/[0.1] rounded-2xl bg-neutral-50/50 dark:bg-[#151516] relative touch-none overflow-hidden shadow-inner cursor-crosshair group"
      >
        <canvas
          ref={canvasRef}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
          onTouchCancel={stopDrawing}
          className="absolute inset-0 block touch-none"
        />
        {!hasDrawn && !initialSignature && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-40 group-hover:opacity-60 transition-opacity">
            <span className="text-[3rem] font-serif italic text-neutral-400 dark:text-neutral-500 transform -rotate-12 select-none">
              Sign Here
            </span>
          </div>
        )}
      </div>
      
      <div className="flex justify-between space-x-3">
        <button
          type="button"
          onClick={handleClear}
          className="flex-1 py-3 px-4 border border-neutral-200/50 dark:border-white/[0.06] bg-white/60 dark:bg-[#1C1C1E]/40 backdrop-blur-sm text-neutral-700 dark:text-[#EBEBF599] font-medium rounded-xl hover:bg-neutral-50 dark:hover:bg-white/[0.06] transition-colors shadow-sm"
        >
          Clear
        </button>
        {!hideCancel && (
          <button
            type="button"
            onClick={() => onCancel?.()}
            className="flex-1 py-3 px-4 border border-neutral-200/50 dark:border-white/[0.06] bg-white/60 dark:bg-[#1C1C1E]/40 backdrop-blur-sm text-neutral-700 dark:text-[#EBEBF599] font-medium rounded-xl hover:bg-neutral-50 dark:hover:bg-white/[0.06] transition-colors shadow-sm"
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          onClick={handleSave}
          className="flex-1 py-3 px-4 bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-xl transition shadow-md hover:shadow-lg hover:-translate-y-0.5"
        >
          Save
        </button>
      </div>
    </div>
  );
}
