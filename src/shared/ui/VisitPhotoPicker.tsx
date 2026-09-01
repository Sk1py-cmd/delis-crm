"use client";

import { useRef, useState } from "react";
import { Camera, ImagePlus, Loader2, Trash2 } from "lucide-react";
import { MAX_VISIT_PHOTOS, MAX_VISIT_PHOTO_DATA_URL_LENGTH } from "@/shared/config/fieldwork";
import { useToast } from "@/shared/ui/Toast";

interface VisitPhotoPickerProps {
  images: string[];
  onChange: (images: string[]) => void;
  disabled?: boolean;
}

const ACCEPTED = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_INPUT_SIZE = 10 * 1024 * 1024;

function readDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Файл не прочитан"));
    reader.onerror = () => reject(new Error("Файл не прочитан"));
    reader.readAsDataURL(file);
  });
}

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Изображение не поддерживается"));
    image.src = source;
  });
}

async function compressPhoto(file: File) {
  if (!ACCEPTED.has(file.type)) throw new Error("Поддерживаются только JPG, PNG и WebP");
  if (file.size <= 0 || file.size > MAX_INPUT_SIZE) throw new Error("Фото должно быть не больше 10 МБ");
  const source = await readDataUrl(file);
  const image = await loadImage(source);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Не удалось обработать фото");

  // Six reports travel in one JSON request. Reduce both dimensions and quality in
  // steps instead of rejecting a detailed camera image unnecessarily.
  for (const [maxSide, quality] of [[1600, 0.78], [1280, 0.68], [1024, 0.64], [800, 0.62]]) {
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const result = canvas.toDataURL("image/jpeg", quality);
    if (result.length <= MAX_VISIT_PHOTO_DATA_URL_LENGTH) return result;
  }
  throw new Error("После сжатия фото всё ещё слишком большое");
}

/** Camera-first picker that keeps compressed data locally until an online or offline visit submission. */
export function VisitPhotoPicker({ images, onChange, disabled = false }: VisitPhotoPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [processing, setProcessing] = useState(false);
  const toast = useToast();

  const addPhotos = async (files: FileList | null) => {
    if (!files?.length || disabled || processing) return;
    const available = Math.max(0, MAX_VISIT_PHOTOS - images.length);
    if (!available) {
      toast(`Можно приложить до ${MAX_VISIT_PHOTOS} фото`, "err");
      return;
    }
    setProcessing(true);
    const next: string[] = [];
    for (const file of Array.from(files).slice(0, available)) {
      try {
        next.push(await compressPhoto(file));
      } catch (error) {
        toast(`${file.name}: ${error instanceof Error ? error.message : "не удалось обработать"}`, "err");
      }
    }
    if (next.length) onChange([...images, ...next]);
    setProcessing(false);
  };

  return (
    <div className="flex flex-col gap-2.5">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        multiple
        className="hidden"
        onChange={(event) => { void addPhotos(event.target.files); event.currentTarget.value = ""; }}
      />
      <button
        type="button"
        className="w-full rounded-2xl border-2 border-dashed px-4 py-4 flex items-center justify-center gap-2 text-sm font-medium"
        style={{ borderColor: "rgba(var(--border))", background: "rgba(var(--table-row))" }}
        disabled={disabled || processing || images.length >= MAX_VISIT_PHOTOS}
        onClick={() => inputRef.current?.click()}
      >
        {processing ? <Loader2 size={18} className="animate-spin" /> : <Camera size={18} color="var(--primary)" />}
        {processing ? "Сжимаем фото…" : <><ImagePlus size={15} /> Сделать фото или выбрать из галереи</>}
      </button>
      {images.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {images.map((image, index) => (
            <div className="relative aspect-square" key={`${index}-${image.slice(0, 24)}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image} alt={`Фотоотчёт ${index + 1}`} className="w-full h-full object-cover rounded-xl" style={{ border: "1px solid rgba(var(--border))" }} />
              <button type="button" title="Удалить фото" disabled={disabled || processing} onClick={() => onChange(images.filter((_, current) => current !== index))} className="absolute -top-1 -right-1 w-6 h-6 rounded-full grid place-items-center text-white" style={{ background: "var(--error)" }}><Trash2 size={12} /></button>
            </div>
          ))}
        </div>
      )}
      <p className="text-[0.68rem] muted">До {MAX_VISIT_PHOTOS} фото. Снимки сжимаются на устройстве и могут быть сохранены в офлайн-очереди.</p>
    </div>
  );
}
