import symmetry from "../assets/compositions/symmetry.jpg";
import diagonal from "../assets/compositions/diagonal.jpg";
import cross from "../assets/compositions/cross.jpg";
import corner from "../assets/compositions/corner.jpg";
import curve from "../assets/compositions/curve.jpg";
import circle from "../assets/compositions/circle.jpg";
import triangle from "../assets/compositions/triangle.jpg";
import radial from "../assets/compositions/radial.jpg";
import frame from "../assets/compositions/frame.jpg";
import horizontal from "../assets/compositions/horizontal.jpg";
import thirds from "../assets/compositions/thirds.jpg";
import spiral from "../assets/compositions/spiral.jpg";

export const compositions = [
  { name: "thirds", label: "三分法构图", image: thirds, paths: ["M533.333 0V900M1066.667 0V900M0 300H1600M0 600H1600"] },
  { name: "symmetry", label: "中心对称构图", image: symmetry, paths: ["M800 0V900"] },
  { name: "diagonal", label: "对角线构图", image: diagonal, paths: ["M0 795L1580 138"] },
  { name: "cross", label: "十字形构图", image: cross, paths: ["M807 0V900", "M0 413H1600"] },
  { name: "corner", label: "L形构图", image: corner, paths: ["M325 45V660H1545"] },
  { name: "curve", label: "S形构图", image: curve, paths: ["M1335 900C1410 680 1025 585 730 425C445 330 545 280 650 257C835 225 590 222 725 178C820 150 740 157 762 132"] },
  { name: "circle", label: "圆形构图", image: circle, paths: ["M990 427A209 209 0 1 1 572 427A209 209 0 1 1 990 427Z"] },
  { name: "triangle", label: "金字塔构图", image: triangle, paths: ["M798 28L510 797H1080Z"] },
  { name: "radial", label: "放射线构图", image: radial, paths: ["M0 0L795 447L1600 0", "M0 900L795 447L1600 900", "M300 0L795 447L1300 0"] },
  { name: "spiral", label: "黄金螺旋构图", image: spiral, paths: ["M220 900C-260 400 400 -180 920 25C1390 210 1450 775 1050 790C730 800 605 450 865 370C1110 295 1230 620 1050 675C885 725 810 505 970 485"] },
  { name: "frame", label: "框架式构图", image: frame, paths: ["M180 142H1420Q1515 142 1515 238V620Q1515 718 1420 718H180Q80 718 80 620V238Q80 142 180 142Z"] },
  { name: "horizontal", label: "水平线构图", image: horizontal, paths: ["M0 520H1600", "M0 620H1600"] },
];
