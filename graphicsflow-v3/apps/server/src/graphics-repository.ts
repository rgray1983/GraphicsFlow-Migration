import type { CreateGraphicInput, GraphicRecord, GraphicsListResponse, GraphicsQuery } from '@graphicsflow/shared';
import { applyGraphicMetadata } from './graphic-metadata-service.js';
import {
  createGraphic as createStoredGraphic,
  DuplicateGraphicError,
  getGraphicById as getStoredGraphicById,
  listGraphics as listStoredGraphics,
} from './graphics-store.js';

export { DuplicateGraphicError };

export function getGraphicById(id: number): GraphicRecord | null {
  const record = getStoredGraphicById(id);
  return record ? applyGraphicMetadata(record) : null;
}

export function listGraphics(query: GraphicsQuery): GraphicsListResponse {
  const result = listStoredGraphics(query);
  return {
    ...result,
    items: result.items.map(applyGraphicMetadata),
  };
}

export function createGraphic(input: CreateGraphicInput): GraphicRecord {
  return applyGraphicMetadata(createStoredGraphic(input));
}
