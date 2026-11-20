import { z } from "@toonflow/nodes-scaffold/runtime";

const coordinate = z.number().min(-100).max(100);
const vector = z.tuple([coordinate, coordinate, coordinate]);
const dimension = z.number().min(0.02).max(40);
const object = z.object({ name: z.string().trim().min(1).max(80), position: vector, yaw: z.number().min(-360).max(360).default(0), color: z.string().regex(/^#[0-9a-f]{6}$/i).default("#7799bb") });
const layout = z.object({
  characters: z.array(object.extend({ pose: z.enum(["stand", "sit", "walk", "run", "crouch", "wave", "think", "phone"]).default("stand") })).max(16),
  props: z.array(object.extend({ shape: z.enum(["box", "sphere", "cylinder", "cone", "torus", "pyramid"]), scale: z.tuple([dimension, dimension, dimension]) })).max(48),
  cameras: z.array(z.object({ name: z.string().trim().min(1).max(80), position: vector, target: vector, fov: z.number().min(15).max(110) })).max(12),
}).refine(value => value.characters.length + value.props.length + value.cameras.length > 0);

export const layoutPrompt = `你是3D分镜导演。根据用户要求规划要追加的场景对象。仅返回一个 JSON 对象，含 characters、props、cameras 三个数组。Y向上，人物约1.8单位高，脚在position，yaw用度数；围绕原点安排走位和朝向，分开人物，机位朝向主体。characters每项含name、position:[x,y,z]、yaw、color(六位十六进制带#)、pose(stand/sit/walk/run/crouch/wave/think/phone)。props每项含name、position、yaw、color、shape(box/sphere/cylinder/cone/torus/pyramid)、scale:[宽,高,深]。cameras每项含name、position、target:[x,y,z]、fov(15到110)。只返回需要添加的对象，不复述已有对象；无要求的类别可为空数组。`;

export function parseLayout(text: string) {
  const json = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return layout.parse(JSON.parse(json));
}
