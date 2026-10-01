"use client";

import { useEffect, useState } from "react";
import { ImageIcon } from "lucide-react";
import { reviews, type EvidenceImage } from "@/lib/api";
import { mapErrorToMessage } from "@/lib/errorHandler";
import { formatSqliteDateSeconds } from "@/lib/sqliteTime";
import { LoadingSpinner } from "@/components/ui";

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Screenshots the student attached to this request. Thumbnails open the full
 * image in a new tab; the bytes come through the BFF with the reviewer's own
 * session, and the backend serves them with nosniff + a sandbox CSP.
 */
export function EvidenceScreenshots({ reviewId }: { reviewId: number }) {
  const [images, setImages] = useState<EvidenceImage[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    reviews
      .listImages(reviewId)
      .then((res) => !cancelled && setImages(res.images))
      .catch((err: unknown) => !cancelled && setError(mapErrorToMessage(err).message));
    return () => {
      cancelled = true;
    };
  }, [reviewId]);

  return (
    <section className="card-surface p-6" aria-labelledby="evidence-screenshots-heading">
      <div className="flex items-center gap-2 mb-3">
        <ImageIcon size={18} className="text-brand" aria-hidden="true" />
        <h2 id="evidence-screenshots-heading" className="text-lg font-bold text-text-main">
          Student screenshots
        </h2>
      </div>
      {error ? (
        <p className="text-sm text-danger">Could not load screenshots: {error}</p>
      ) : images === null ? (
        <LoadingSpinner message="Loading screenshots..." />
      ) : images.length === 0 ? (
        <p className="text-sm text-text-muted">No screenshots were attached to this request.</p>
      ) : (
        <>
          <ul className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {images.map((img, i) => {
              const src = reviews.imageUrl(reviewId, img.id);
              return (
                <li key={img.id} className="rounded-lg border border-border overflow-hidden bg-primary">
                  <a href={src} target="_blank" rel="noopener noreferrer" className="block focus-ring" title="Open full size">
                    {/* eslint-disable-next-line @next/next/no-img-element -- authenticated upload served via the BFF */}
                    <img
                      src={src}
                      alt={img.caption || img.original_name || `Screenshot ${i + 1}`}
                      loading="lazy"
                      className="aspect-video w-full object-cover bg-muted"
                    />
                  </a>
                  <div className="px-2 py-1.5 text-xs">
                    <p className="font-medium text-text-main truncate">{img.caption || img.original_name || `Screenshot ${i + 1}`}</p>
                    <p className="text-text-muted">
                      {img.width && img.height ? `${img.width}×${img.height} · ` : ""}
                      {formatSize(img.byte_size)} · {formatSqliteDateSeconds(img.created_at)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-text-muted mt-3">
            Screenshots support the automated evidence above; they can be edited or reused, so weigh them against the
            verifier results and the SIEM snapshot.
          </p>
        </>
      )}
    </section>
  );
}
