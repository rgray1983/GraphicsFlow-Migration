import { useQuery } from '@tanstack/react-query';
import type { PreviewResponse, PreviewVariant } from '@graphicsflow/shared';
import './PreviewAsset.css';

async function fetchPreview(graphicId: number, variant: PreviewVariant): Promise<PreviewResponse> {
  const response = await fetch(`/api/previews/${graphicId}/${variant}`);
  if (!response.ok) throw new Error('Preview could not be generated.');
  return response.json() as Promise<PreviewResponse>;
}

type PreviewAssetProps = {
  graphicId: number;
  variant?: PreviewVariant;
  alt: string;
};

export function PreviewAsset({ graphicId, variant = 'medium', alt }: PreviewAssetProps) {
  const previewQuery = useQuery({
    queryKey: ['preview', graphicId, variant],
    queryFn: () => fetchPreview(graphicId, variant),
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });

  if (previewQuery.isPending) {
    return <div className="preview-asset preview-asset-loading" aria-label="Generating approval preview"><span /></div>;
  }

  if (previewQuery.isError || !previewQuery.data) {
    return <div className="preview-asset preview-asset-message"><strong>Preview unavailable</strong><span>The source approval is still connected and can be viewed later.</span></div>;
  }

  const preview = previewQuery.data;
  if (preview.status !== 'ready' || !preview.imageUrl) {
    return <div className="preview-asset preview-asset-message"><strong>{preview.status === 'error' ? 'Preview generation failed' : 'Preview unavailable'}</strong><span>{preview.message || 'No browser preview is available for this document.'}</span></div>;
  }

  return (
    <div className="preview-asset preview-asset-ready">
      <img alt={alt} src={`${preview.imageUrl}?generated=${encodeURIComponent(preview.generatedAt || '')}`} />
    </div>
  );
}
