import { IconLayoutGrid } from "@tabler/icons-vue";
import { isNodeOutput, type NodeMediaValue } from "@toonflow/nodes-scaffold/values";
import { storyboardNodeType } from "@toonflow/server/nodeMenu";

export const storyboardOption = { type: storyboardNodeType, label: "分镜格子", icon: IconLayoutGrid };
export const storyboardRatios = ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] as const;
export const storyboardSizes = [2, 3, 4, 5] as const;
export const storyboardMaxSide = 10;

export type StoryboardShot = { id: string; label: string; media: NodeMediaValue };
export type Storyboard = {
  ratio: typeof storyboardRatios[number];
  rows: number;
  columns: number;
  shots: (StoryboardShot | null)[];
  numbered: boolean;
};

export function validStoryboardSide(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= storyboardMaxSide;
}

export function readStoryboard(value: (Partial<Storyboard> & { size?: number }) | undefined): Storyboard {
  const legacySize = validStoryboardSide(value?.size) ? value.size : 3;
  const rows = validStoryboardSide(value?.rows) ? value.rows : legacySize;
  const columns = validStoryboardSide(value?.columns) ? value.columns : legacySize;
  return {
    rows,
    columns,
    ratio: value?.ratio && storyboardRatios.includes(value.ratio) ? value.ratio : "16:9",
    shots: Array.from({ length: rows * columns }, (_, index) => {
      const shot = value?.shots?.[index];
      return shot && typeof shot.id === "string" && typeof shot.label === "string"
        && isNodeOutput({ dataType: "IMAGE", value: shot.media }) ? shot : null;
    }),
    numbered: value?.numbered === true,
  };
}
