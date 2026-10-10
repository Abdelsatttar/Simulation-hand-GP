import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const mount = $("#three-root");
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xeaf0f3);
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
camera.position.set(3.25, -0.1, 11.3);
camera.lookAt(0, -1.05, 0);

let renderer;
let controls;
let modelReady = false;

const handRoot = new THREE.Group();
handRoot.name = "NeuroGrip procedural hand concept";
scene.add(handRoot);

const layerObjects = {
  shell: [],
  structure: [],
  tendons: [],
  servos: [],
  electronics: [],
  labels: [],
  emg: [],
  forearm: []
};
const shellMaterials = [];
const fingers = [];
const servoBlocks = [];
const servoHorns = [];
let currentPose = "open";
let isExploded = false;
let explodeTarget = 0;
let explodeAmount = 0;
let xrayEnabled = false;
let baseEmgLevel = 12;
let displayedEmgLevel = 12;
let thresholdLevel = 28;
let autoSignal = true;
let signalHistory = [];
let sampleCount = 0;
let lastUiPaint = 0;
let latestVoltage = 0.40;
let latestGrip = 0;
let hardwareMode = false;
let serialConnected = false;
let serialPort = null;
let serialReader = null;
let serialWriter = null;
let latestHardware = null;
const clock = new THREE.Clock();

const mat = {
  shell: new THREE.MeshPhysicalMaterial({ color: 0xd9e2e7, roughness: 0.3, metalness: 0.18, clearcoat: 0.35, clearcoatRoughness: 0.25 }),
  shellDark: new THREE.MeshStandardMaterial({ color: 0xabbcc5, roughness: 0.4, metalness: 0.22 }),
  shellAccent: new THREE.MeshStandardMaterial({ color: 0xf3f6f7, roughness: 0.27, metalness: 0.12 }),
  graphite: new THREE.MeshStandardMaterial({ color: 0x243947, roughness: 0.38, metalness: 0.42 }),
  bone: new THREE.MeshStandardMaterial({ color: 0xb4c8cb, roughness: 0.44, metalness: 0.16 }),
  joint: new THREE.MeshPhysicalMaterial({ color: 0x4d6674, roughness: 0.27, metalness: 0.72 }),
  brass: new THREE.MeshStandardMaterial({ color: 0xd4a369, roughness: 0.28, metalness: 0.78 }),
  tendon: new THREE.MeshStandardMaterial({ color: 0xd6a05f, roughness: 0.4, metalness: 0.25 }),
  cableDark: new THREE.MeshStandardMaterial({ color: 0x283c4a, roughness: 0.42, metalness: 0.25 }),
  servo: new THREE.MeshPhysicalMaterial({ color: 0x4d84a0, roughness: 0.3, metalness: 0.42, clearcoat: 0.2 }),
  servoTop: new THREE.MeshStandardMaterial({ color: 0x8eb1c2, roughness: 0.3, metalness: 0.5 }),
  pcb: new THREE.MeshStandardMaterial({ color: 0x176a58, roughness: 0.55, metalness: 0.15 }),
  pcbDark: new THREE.MeshStandardMaterial({ color: 0x162936, roughness: 0.48, metalness: 0.3 }),
  chip: new THREE.MeshStandardMaterial({ color: 0x111b24, roughness: 0.4, metalness: 0.18 }),
  ceramic: new THREE.MeshStandardMaterial({ color: 0xe5ecec, roughness: 0.23, metalness: 0.08 }),
  copper: new THREE.MeshStandardMaterial({ color: 0xbe8158, roughness: 0.3, metalness: 0.7 }),
  wireTeal: new THREE.MeshStandardMaterial({ color: 0x29b9a9, roughness: 0.38, metalness: 0.1 }),
  wireOrange: new THREE.MeshStandardMaterial({ color: 0xe39e51, roughness: 0.38, metalness: 0.08 }),
  white: new THREE.MeshStandardMaterial({ color: 0xf5f7f8, roughness: 0.3, metalness: 0.08 }),
  skin: new THREE.MeshPhysicalMaterial({ color: 0xc18a6b, roughness: 0.78, metalness: 0.0, clearcoat: 0.03, clearcoatRoughness: 0.8 }),
  adhesive: new THREE.MeshStandardMaterial({ color: 0xe5dcd0, roughness: 0.95, metalness: 0.0 }),
  sensorGlass: new THREE.MeshPhysicalMaterial({ color: 0x193d59, roughness: 0.16, metalness: 0.35, clearcoat: 0.9 }),
  sensorBlue: new THREE.MeshStandardMaterial({ color: 0x287fe5, roughness: 0.28, metalness: 0.45 })
};

function addToLayer(parent, object, layer, explodeVector = [0, 0, 0]) {
  parent.add(object);
  object.userData.layer = layer;
  object.userData.basePosition = object.position.clone();
  object.userData.explodeVector = new THREE.Vector3(...explodeVector);
  object.castShadow = true;
  object.receiveShadow = true;
  if (layerObjects[layer]) layerObjects[layer].push(object);
  return object;
}

function addMesh(parent, geometry, material, layer, position = [0, 0, 0], options = {}) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  mesh.name = options.name || "";
  if (options.scale) mesh.scale.set(...options.scale);
  if (options.rotation) mesh.rotation.set(...options.rotation);
  if (options.noShadow) {
    mesh.castShadow = false;
    mesh.receiveShadow = false;
  }
  if (layer === "shell") shellMaterials.push(material);
  return addToLayer(parent, mesh, layer, options.explode || [0, 0, 0]);
}

function addLine(parent, points, material, layer, radius = 0.008, explode = [0, 0, 0]) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => p.isVector3 ? p : new THREE.Vector3(...p)));
  const geometry = new THREE.TubeGeometry(curve, Math.max(24, points.length * 9), radius, 8, false);
  const mesh = new THREE.Mesh(geometry, material);
  return addToLayer(parent, mesh, layer, explode);
}

function addScrew(parent, position, radius = 0.027, layer = "shell") {
  const screw = addMesh(
    parent,
    new THREE.CylinderGeometry(radius, radius, 0.016, 16),
    mat.brass,
    layer,
    position,
    { rotation: [Math.PI / 2, 0, 0], explode: [0, 0.03, 0.12] }
  );
  const slot = addMesh(
    parent,
    new THREE.BoxGeometry(radius * 1.1, 0.008, 0.004),
    mat.graphite,
    layer,
    [position[0], position[1], position[2] + 0.011],
    { explode: [0, 0.03, 0.12] }
  );
  return [screw, slot];
}

function createLabel(text, position, tint = "#2b6a71") {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 120;
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "rgba(255,255,255,0.92)";
  context.strokeStyle = "rgba(77,139,147,0.55)";
  context.lineWidth = 3;
  roundRect(context, 3, 3, 506, 114, 18);
  context.fill();
  context.stroke();
  context.fillStyle = tint;
  context.font = "600 33px 'DM Mono', monospace";
  context.fillText(text.toUpperCase(), 25, 73);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const spriteMaterial = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(spriteMaterial);
  sprite.position.set(...position);
  sprite.scale.set(0.78, 0.19, 1);
  sprite.renderOrder = 12;
  addToLayer(handRoot, sprite, "labels", [0.12, 0.03, 0.2]);
  return sprite;
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function makePalmShell() {
  const shape = new THREE.Shape();
  shape.moveTo(-0.37, -1.02);
  shape.quadraticCurveTo(-0.57, -0.94, -0.61, -0.66);
  shape.lineTo(-0.68, 0.08);
  shape.quadraticCurveTo(-0.69, 0.61, -0.42, 0.84);
  shape.quadraticCurveTo(-0.13, 0.94, 0.34, 0.89);
  shape.quadraticCurveTo(0.61, 0.79, 0.63, 0.48);
  shape.lineTo(0.59, -0.45);
  shape.quadraticCurveTo(0.54, -0.86, 0.34, -1.02);
  shape.quadraticCurveTo(0, -1.1, -0.37, -1.02);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.34,
    bevelEnabled: true,
    bevelSegments: 4,
    steps: 1,
    bevelSize: 0.045,
    bevelThickness: 0.05,
    curveSegments: 12
  });
  geometry.computeVertexNormals();
  addMesh(handRoot, geometry, mat.shell, "shell", [0, 0, -0.19], { name: "Palm outer shell", explode: [0, 0.08, 0.24] });

  // Fine dorsal access panel, inset seams, tactile pad details, and assembly screws.
  const panel = new THREE.Shape();
  panel.moveTo(-0.43, 0.35);
  panel.quadraticCurveTo(-0.38, 0.76, -0.14, 0.78);
  panel.lineTo(0.28, 0.75);
  panel.quadraticCurveTo(0.48, 0.71, 0.47, 0.45);
  panel.lineTo(0.44, -0.1);
  panel.quadraticCurveTo(0.03, 0.03, -0.43, -0.02);
  panel.closePath();
  const panelGeometry = new THREE.ShapeGeometry(panel, 14);
  addMesh(handRoot, panelGeometry, mat.shellAccent, "shell", [0, 0, 0.166], { name: "Palm dorsal access panel", explode: [0, 0.08, 0.25] });

  const seamMaterial = new THREE.LineBasicMaterial({ color: 0x93a8b0, transparent: true, opacity: 0.78 });
  const seamPoints = [
    [[-0.43, -0.42, 0.181], [-0.23, -0.46, 0.181], [0.03, -0.47, 0.181], [0.40, -0.41, 0.181]],
    [[-0.50, 0.25, 0.182], [-0.18, 0.20, 0.182], [0.19, 0.22, 0.182], [0.48, 0.26, 0.182]],
    [[-0.14, 0.75, 0.178], [-0.12, 0.52, 0.178], [-0.11, 0.28, 0.178]]
  ];
  seamPoints.forEach(points => {
    const lineGeometry = new THREE.BufferGeometry().setFromPoints(points.map(p => new THREE.Vector3(...p)));
    const line = new THREE.Line(lineGeometry, seamMaterial);
    addToLayer(handRoot, line, "shell", [0, 0.08, 0.25]);
  });

  [[-0.46, 0.49, 0.21], [0.43, 0.49, 0.21], [-0.42, -0.68, 0.14], [0.37, -0.69, 0.14], [-0.42, -0.06, 0.18], [0.42, -0.07, 0.18]].forEach(p => addScrew(handRoot, p, 0.023, "shell"));

  // Palm supports and metacarpal structure are placed behind the outer panels.
  const supportPositions = [
    [-0.35, 0.12, -0.1, -0.29, 0.7, -0.1],
    [-0.16, 0.0, -0.1, -0.14, 0.77, -0.1],
    [0.05, -0.02, -0.1, 0.08, 0.75, -0.1],
    [0.27, 0.06, -0.1, 0.30, 0.69, -0.1],
    [-0.05, -0.82, -0.06, -0.08, -0.28, -0.06]
  ];
  supportPositions.forEach((p, i) => {
    const a = new THREE.Vector3(p[0], p[1], p[2]);
    const b = new THREE.Vector3(p[3], p[4], p[5]);
    const direction = b.clone().sub(a);
    const geometry = new THREE.CylinderGeometry(i === 4 ? 0.07 : 0.055, i === 4 ? 0.085 : 0.075, direction.length(), 12);
    const bone = addMesh(handRoot, geometry, mat.bone, "structure", a.clone().add(b).multiplyScalar(0.5).toArray(), { explode: [0, -0.05, -0.28] });
    bone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    addMesh(handRoot, new THREE.SphereGeometry(0.075, 16, 12), mat.joint, "structure", p.slice(0, 3), { explode: [0, -0.05, -0.28] });
  });

  // Central tendon guides and anchor bridge.
  [-0.28, -0.07, 0.15, 0.34].forEach((x, index) => {
    addMesh(handRoot, new THREE.TorusGeometry(0.07, 0.012, 8, 18), mat.brass, "structure", [x, 0.15, -0.02], {
      rotation: [Math.PI / 2, 0, 0], explode: [0, -0.04, -0.2]
    });
  });
}

function createFinger(key, label, x, lengths, radius, baseAngle = 0) {
  const root = new THREE.Group();
  root.name = label + " finger rig";
  root.position.set(x, 0.71, 0.13);
  root.rotation.z = baseAngle;
  handRoot.add(root);

  const joints = [];
  let segmentParent = root;
  const wholeLength = lengths.reduce((sum, value) => sum + value, 0);

  lengths.forEach((length, index) => {
    const segmentRadius = radius * (index === 2 ? 0.82 : index === 1 ? 0.92 : 1);
    const shellGeometry = new THREE.CapsuleGeometry(segmentRadius, Math.max(0.015, length - 2 * segmentRadius), 5, 14);
    addMesh(segmentParent, shellGeometry, index === 2 ? mat.shellAccent : mat.shell, "shell", [0, length / 2, 0.01], {
      name: label + " phalanx " + (index + 1), explode: [0.035, 0.02, 0.24]
    });

    // A small raised knuckle cover and rubberized finger pad create real scale cues.
    addMesh(segmentParent, new THREE.SphereGeometry(segmentRadius * 0.73, 16, 12), mat.shellDark, "shell", [0, length * 0.09, 0.065], {
      scale: [1.12, 0.42, 0.48], explode: [0.035, 0.02, 0.24]
    });
    addMesh(segmentParent, new THREE.SphereGeometry(segmentRadius * 0.75, 18, 14), mat.graphite, "shell", [0, length * 0.84, 0.045], {
      scale: [0.9, 0.24, 0.3], explode: [0.035, 0.02, 0.24]
    });

    const coreRadius = segmentRadius * 0.33;
    addMesh(segmentParent, new THREE.CylinderGeometry(coreRadius * 0.86, coreRadius, length * 0.67, 10), mat.bone, "structure", [0, length * 0.5, -0.055], {
      explode: [-0.025, 0, -0.27]
    });
    addMesh(segmentParent, new THREE.SphereGeometry(coreRadius * 1.25, 12, 10), mat.joint, "structure", [0, length * 0.11, -0.06], {
      explode: [-0.025, 0, -0.27]
    });

    // Tendon remains visible inside the phalanx and follows articulation.
    addLine(segmentParent, [[0, 0.07, 0.078], [0, length * 0.34, 0.093], [0, length * 0.7, 0.093], [0, length - 0.08, 0.078]], mat.tendon, "tendons", 0.009, [0.045, 0.01, 0.28]);
    // Two thin service leads follow each phalanx like real actuator/sensor wiring.
    addLine(segmentParent, [[-segmentRadius * 0.62, 0.045, 0.068], [-segmentRadius * 0.62, length * 0.42, 0.09], [-segmentRadius * 0.5, length - 0.045, 0.08]], mat.cableDark, "tendons", 0.009, [0.05, 0.01, 0.3]);
    addLine(segmentParent, [[segmentRadius * 0.62, 0.045, 0.068], [segmentRadius * 0.62, length * 0.42, 0.09], [segmentRadius * 0.5, length - 0.045, 0.08]], mat.wireOrange, "tendons", 0.007, [0.05, 0.01, 0.3]);

    if (index < lengths.length - 1) {
      const joint = new THREE.Group();
      joint.position.set(0, length, 0);
      segmentParent.add(joint);
      addMesh(joint, new THREE.SphereGeometry(segmentRadius * 0.73, 18, 14), mat.joint, "structure", [0, 0, -0.03], {
        explode: [-0.018, 0.01, -0.27]
      });
      addMesh(joint, new THREE.CylinderGeometry(segmentRadius * 0.56, segmentRadius * 0.56, segmentRadius * 0.28, 16), mat.brass, "structure", [0, 0, 0.005], {
        rotation: [Math.PI / 2, 0, 0], explode: [-0.018, 0.01, -0.27]
      });
      joints.push(joint);
      segmentParent = joint;
    } else {
      addMesh(segmentParent, new THREE.SphereGeometry(segmentRadius * 0.74, 16, 12), mat.bone, "structure", [0, length * 0.9, -0.06], {
        scale: [0.82, 0.7, 0.65], explode: [-0.025, 0, -0.27]
      });

    }
  });

  // Base knuckle ring and hinge cap.
  addMesh(root, new THREE.TorusGeometry(radius * 0.8, 0.018, 8, 18), mat.brass, "structure", [0, 0.045, -0.035], {
    rotation: [Math.PI / 2, 0, 0], explode: [-0.015, 0, -0.25]
  });

  fingers.push({ key, label, root, joints, baseAngle, lengths, radius, wholeLength });
  return root;
}

function createThumb() {
  const root = new THREE.Group();
  root.name = "Opposable thumb rig";
  root.position.set(-0.51, 0.03, 0.08);
  root.rotation.z = -0.82;
  handRoot.add(root);
  const lengths = [0.42, 0.34, 0.27];
  const radius = 0.105;
  const joints = [];
  let segmentParent = root;

  lengths.forEach((length, index) => {
    const r = radius * (index === 2 ? 0.83 : 1);
    addMesh(segmentParent, new THREE.CapsuleGeometry(r, Math.max(0.015, length - 2 * r), 5, 14), mat.shell, "shell", [0, length / 2, 0.015], {
      name: "Thumb phalanx " + (index + 1), explode: [-0.06, 0.05, 0.26]
    });
    addMesh(segmentParent, new THREE.SphereGeometry(r * 0.68, 16, 12), mat.graphite, "shell", [0, length * 0.8, 0.055], {
      scale: [0.95, 0.24, 0.33], explode: [-0.06, 0.05, 0.26]
    });
    addMesh(segmentParent, new THREE.CylinderGeometry(r * 0.3, r * 0.34, length * 0.65, 10), mat.bone, "structure", [0, length * 0.48, -0.055], {
      explode: [-0.07, 0.03, -0.27]
    });
    addLine(segmentParent, [[0, 0.06, 0.07], [0, length * 0.4, 0.08], [0, length - 0.06, 0.06]], mat.tendon, "tendons", 0.009, [-0.06, 0.04, 0.28]);
    if (index < lengths.length - 1) {
      const joint = new THREE.Group();
      joint.position.y = length;
      segmentParent.add(joint);
      addMesh(joint, new THREE.SphereGeometry(r * 0.7, 16, 12), mat.joint, "structure", [0, 0, -0.04], { explode: [-0.07, 0.03, -0.27] });
      addMesh(joint, new THREE.CylinderGeometry(r * 0.5, r * 0.5, r * 0.25, 16), mat.brass, "structure", [0, 0, 0], {
        rotation: [Math.PI / 2, 0, 0], explode: [-0.07, 0.03, -0.27]
      });
      joints.push(joint);
      segmentParent = joint;
    }
  });
  addMesh(root, new THREE.SphereGeometry(0.13, 20, 16), mat.joint, "structure", [0, 0, -0.04], { explode: [-0.07, 0.02, -0.28] });
  addMesh(root, new THREE.TorusGeometry(0.13, 0.022, 8, 20), mat.brass, "structure", [0, 0, 0.02], {
    rotation: [Math.PI / 2, 0, 0], explode: [-0.07, 0.02, -0.28]
  });
  fingers.push({ key: "thumb", label: "Thumb", root, joints, baseAngle: -0.82, lengths, radius, wholeLength: 1.03 });
}

function createActuatorsAndCuff() {
  // Forearm cuff and tapered socket.
  addMesh(handRoot, new THREE.CylinderGeometry(0.38, 0.43, 0.79, 36, 1, false), mat.graphite, "shell", [0, -2.08, -0.02], {
    name: "Forearm cuff", explode: [0, -0.2, 0.22]
  });
  addMesh(handRoot, new THREE.CylinderGeometry(0.4, 0.4, 0.105, 36), mat.shellDark, "shell", [0, -1.68, -0.02], {
    explode: [0, -0.12, 0.22]
  });
  addMesh(handRoot, new THREE.CylinderGeometry(0.43, 0.43, 0.07, 36), mat.shellAccent, "shell", [0, -2.45, -0.02], {
    explode: [0, -0.25, 0.22]
  });
  addMesh(handRoot, new THREE.CylinderGeometry(0.37, 0.37, 0.53, 36), mat.shellDark, "structure", [0, -2.08, -0.03], {
    explode: [0, -0.18, -0.25]
  });
  // Longitudinal cuff reinforcement rails.
  [-0.28, 0.28].forEach(x => {
    addMesh(handRoot, new THREE.BoxGeometry(0.055, 0.67, 0.035), mat.bone, "structure", [x, -2.05, 0.28], {
      explode: [x * 0.15, -0.18, -0.25]
    });
  });

  const xSlots = [-0.45, -0.225, 0, 0.225, 0.45];
  const names = ["INDEX", "MIDDLE", "RING", "LITTLE", "THUMB"];
  xSlots.forEach((x, index) => {
    const group = new THREE.Group();
    group.position.set(x, -1.43, 0.30);
    handRoot.add(group);
    addMesh(group, new THREE.BoxGeometry(0.19, 0.27, 0.22), mat.servo, "servos", [0, 0, 0], {
      name: names[index] + " micro servo", explode: [x * 0.45, -0.035, 0.22]
    });
    addMesh(group, new THREE.BoxGeometry(0.12, 0.17, 0.018), mat.servoTop, "servos", [0, 0.01, 0.12], {
      explode: [x * 0.45, -0.035, 0.22]
    });
    addMesh(group, new THREE.CylinderGeometry(0.044, 0.044, 0.04, 16), mat.graphite, "servos", [0, 0.13, 0.13], {
      rotation: [Math.PI / 2, 0, 0], explode: [x * 0.45, -0.035, 0.22]
    });
    const horn = addMesh(group, new THREE.BoxGeometry(0.1, 0.035, 0.025), mat.white, "servos", [0, 0.16, 0.16], {
      rotation: [0, 0, index % 2 ? -0.22 : 0.22], explode: [x * 0.45, -0.035, 0.22]
    });
    horn.userData.baseHornRotationZ = horn.rotation.z;
    servoHorns[index] = horn;
    [[-0.067, -0.09, 0.117], [0.067, -0.09, 0.117]].forEach(p => {
      addMesh(group, new THREE.CylinderGeometry(0.012, 0.012, 0.014, 10), mat.brass, "servos", p, {
        rotation: [Math.PI / 2, 0, 0], explode: [x * 0.45, -0.035, 0.22]
      });
    });
    // A colored 3-wire lead from each servo, physically represented in the model.
    const cableColor = index % 2 ? mat.wireTeal : mat.wireOrange;
    addLine(handRoot, [
      [x, -1.53, 0.39],
      [x + (index - 2) * 0.035, -1.7, 0.42],
      [x * 0.72, -1.82, 0.44],
      [x * 0.5, -1.89, 0.43]
    ], cableColor, "tendons", 0.012, [x * 0.5, -0.03, 0.23]);
    servoBlocks.push(group);
  });
}

function createElectronics() {
  // ESP32 carrier board mounted to the dorsal side of the forearm cuff.
  const board = new THREE.Group();
  board.position.set(0, -2.07, 0.405);
  handRoot.add(board);
  addMesh(board, new THREE.BoxGeometry(0.61, 0.46, 0.055), mat.pcb, "electronics", [0, 0, 0], {
    name: "ESP32 DevKit board", explode: [0, -0.14, 0.34]
  });
  addMesh(board, new THREE.BoxGeometry(0.34, 0.13, 0.035), mat.pcbDark, "electronics", [0, 0.10, 0.042], {
    explode: [0, -0.14, 0.35]
  });
  addMesh(board, new THREE.BoxGeometry(0.13, 0.035, 0.02), mat.ceramic, "electronics", [0.15, 0.115, 0.065], {
    explode: [0, -0.14, 0.35]
  });
  addMesh(board, new THREE.BoxGeometry(0.13, 0.05, 0.042), mat.chip, "electronics", [-0.02, -0.035, 0.047], {
    explode: [0, -0.14, 0.35]
  });
  addMesh(board, new THREE.BoxGeometry(0.16, 0.07, 0.045), mat.shellDark, "electronics", [0, -0.185, 0.055], {
    explode: [0, -0.14, 0.35]
  });
  // USB shield.
  addMesh(board, new THREE.BoxGeometry(0.12, 0.055, 0.07), mat.ceramic, "electronics", [0, -0.24, 0.045], {
    explode: [0, -0.14, 0.35]
  });
  // Header rails and visible GPIO solder points.
  [-0.255, 0.255].forEach(x => {
    addMesh(board, new THREE.BoxGeometry(0.035, 0.36, 0.03), mat.chip, "electronics", [x, 0, 0.045], {
      explode: [0, -0.14, 0.35]
    });
    for (let i = 0; i < 9; i++) {
      addMesh(board, new THREE.CylinderGeometry(0.009, 0.009, 0.035, 8), mat.brass, "electronics", [x, -0.145 + i * 0.036, 0.065], {
        explode: [0, -0.14, 0.35]
      });
    }
  });
  for (let i = 0; i < 7; i++) {
    addMesh(board, new THREE.BoxGeometry(0.03, 0.016, 0.012), mat.copper, "electronics", [-0.15 + i * 0.05, 0.19, 0.035], {
      explode: [0, -0.14, 0.35]
    });
  }

  // Low-profile harness cable trunk from the board to the servo row.
  addLine(handRoot, [[0.14, -2.28, 0.48], [0.12, -1.98, 0.49], [0.1, -1.76, 0.47], [0.08, -1.62, 0.45]], mat.cableDark, "tendons", 0.026, [0.02, -0.1, 0.22]);
  [-0.015, 0.005, 0.025].forEach((dx, i) => {
    addLine(handRoot, [[dx, -2.28, 0.49], [dx, -2.0, 0.5], [dx, -1.78, 0.48], [dx, -1.62, 0.46]], i === 1 ? mat.wireTeal : mat.wireOrange, "tendons", 0.008, [0.02, -0.1, 0.23]);
  });
}

function createForearmAndEmgPads() {
  // Human-forearm reference shape with procedural skin grain, behind the prosthetic wrist.
  const skinCanvas = document.createElement("canvas");
  skinCanvas.width = 256;
  skinCanvas.height = 512;
  const skinCtx = skinCanvas.getContext("2d");
  skinCtx.fillStyle = "#c58f70";
  skinCtx.fillRect(0, 0, skinCanvas.width, skinCanvas.height);
  for (let i = 0; i < 9500; i++) {
    skinCtx.fillStyle = Math.random() > 0.5 ? "rgba(93,47,31,0.045)" : "rgba(255,222,187,0.06)";
    const x = Math.random() * skinCanvas.width;
    const y = Math.random() * skinCanvas.height;
    const r = Math.random() * 1.5 + 0.2;
    skinCtx.beginPath();
    skinCtx.ellipse(x, y, r, r * (Math.random() * 1.5 + 0.5), Math.random(), 0, Math.PI * 2);
    skinCtx.fill();
  }
  for (let i = 0; i < 13; i++) {
    skinCtx.strokeStyle = "rgba(111,63,44,0.035)";
    skinCtx.lineWidth = 1 + Math.random() * 2;
    skinCtx.beginPath();
    const y = Math.random() * skinCanvas.height;
    skinCtx.moveTo(0, y);
    skinCtx.bezierCurveTo(70, y - 8, 160, y + 12, 256, y + 3);
    skinCtx.stroke();
  }
  const skinTexture = new THREE.CanvasTexture(skinCanvas);
  skinTexture.colorSpace = THREE.SRGBColorSpace;
  skinTexture.wrapS = THREE.RepeatWrapping;
  skinTexture.wrapT = THREE.RepeatWrapping;
  skinTexture.repeat.set(1.25, 1.1);
  mat.skin.map = skinTexture;
  mat.skin.bumpMap = skinTexture;
  mat.skin.bumpScale = 0.012;
  mat.skin.needsUpdate = true;

  const forearm = addMesh(handRoot, new THREE.CylinderGeometry(0.365, 0.54, 2.18, 48, 2, false), mat.skin, "forearm", [0.035, -3.52, -0.075], {
    name: "Forearm anatomical reference", explode: [0, -0.27, -0.13]
  });
  forearm.geometry.computeVertexNormals();
  // Rounded distal forearm end avoids an unnatural flat cylinder cut-off.
  addMesh(handRoot, new THREE.SphereGeometry(0.535, 32, 24), mat.skin, "forearm", [0.035, -4.48, -0.075], {
    scale: [1, 0.42, 1], name: "Rounded forearm end", explode: [0, -0.28, -0.13]
  });

  [-2.7, -4.25].forEach(y => {
    const t = clamp(Math.abs(y + 2.43) / 2.18, 0, 1);
    const radius = 0.365 + t * (0.54 - 0.365);
    addMesh(handRoot, new THREE.TorusGeometry(radius, 0.024, 10, 48), mat.graphite, "shell", [0.035, y, -0.075], {
      rotation: [Math.PI / 2, 0, 0], explode: [0, -0.24, -0.13]
    });
    addMesh(handRoot, new THREE.TorusGeometry(radius + 0.008, 0.006, 8, 48), mat.shellDark, "shell", [0.035, y + 0.035, -0.075], {
      rotation: [Math.PI / 2, 0, 0], explode: [0, -0.24, -0.13]
    });
  });

  // Four electrode pods are shown on the forearm as in the reference image.
  const pads = [
    { name: "sEMG 1 · Flexor", x: -0.125, y: -2.82 },
    { name: "sEMG 2 · Extensor", x: 0.125, y: -3.2 },
    { name: "sEMG 3 · Auxiliary", x: -0.125, y: -3.58 },
    { name: "sEMG 4 · Auxiliary", x: 0.125, y: -3.94 }
  ];
  pads.forEach((pad, index) => {
    const t = clamp(Math.abs(pad.y + 2.43) / 2.18, 0, 1);
    const radius = 0.365 + t * (0.54 - 0.365);
    const z = -0.075 + Math.sqrt(Math.max(0, radius * radius - pad.x * pad.x)) + 0.015;
    addMesh(handRoot, new THREE.CylinderGeometry(0.094, 0.094, 0.026, 28), mat.adhesive, "emg", [pad.x, pad.y, z], {
      rotation: [Math.PI / 2, 0, 0], name: pad.name + " adhesive electrode", explode: [-0.12, -0.18, 0.3]
    });
    addMesh(handRoot, new THREE.CylinderGeometry(0.059, 0.059, 0.018, 24), mat.shellDark, "emg", [pad.x, pad.y, z + 0.019], {
      rotation: [Math.PI / 2, 0, 0], name: pad.name + " electrode contact", explode: [-0.12, -0.18, 0.32]
    });
    addMesh(handRoot, new THREE.CylinderGeometry(0.027, 0.027, 0.014, 18), mat.graphite, "emg", [pad.x, pad.y, z + 0.034], {
      rotation: [Math.PI / 2, 0, 0], explode: [-0.12, -0.18, 0.34]
    });
    addMesh(handRoot, new THREE.CylinderGeometry(0.011, 0.011, 0.016, 12), mat.copper, "emg", [pad.x, pad.y, z + 0.045], {
      rotation: [Math.PI / 2, 0, 0], explode: [-0.12, -0.18, 0.35]
    });

    const boardX = 0.29;
    const boardY = -4.02;
    const boardZ = 0.455;
    const xMid = (pad.x + boardX) * 0.5;
    const yMid = (pad.y + boardY) * 0.5;
    addLine(handRoot, [[pad.x,pad.y,z+0.05],[pad.x*0.75,yMid+0.08,z+0.075],[xMid,yMid,boardZ],[boardX,boardY+index*0.022,boardZ]], index % 2 ? mat.wireOrange : mat.wireTeal, "tendons", 0.009, [-0.12,-0.18,0.32]);
  });

  // EMG conditioning board and strain-relieved lead into the wrist controller.
  const emgBoard = new THREE.Group();
  emgBoard.position.set(0.29, -4.02, 0.455);
  emgBoard.rotation.z = -0.12;
  handRoot.add(emgBoard);
  addMesh(emgBoard, new THREE.BoxGeometry(0.27, 0.42, 0.075), mat.pcb, "electronics", [0,0,0], {
    name: "sEMG signal conditioning board", explode: [0.14,-0.2,0.32]
  });
  addMesh(emgBoard, new THREE.BoxGeometry(0.17,0.19,0.028), mat.pcbDark, "electronics", [0,0.025,0.052], {
    explode: [0.14,-0.2,0.35]
  });
  addMesh(emgBoard, new THREE.BoxGeometry(0.1,0.035,0.022), mat.chip, "electronics", [0,-0.105,0.053], {
    explode: [0.14,-0.2,0.35]
  });
  addMesh(emgBoard, new THREE.BoxGeometry(0.105,0.025,0.025), mat.shellAccent, "electronics", [0,0.175,0.045], {
    explode: [0.14,-0.2,0.35]
  });
  addLine(handRoot, [[0.29,-3.82,0.5],[0.24,-3.38,0.49],[0.19,-2.9,0.46],[0.18,-2.5,0.42],[0.13,-2.2,0.42]], mat.cableDark, "tendons", 0.023, [0.1,-0.15,0.24]);
  addLine(handRoot, [[0.29,-3.82,0.515],[0.24,-3.38,0.505],[0.19,-2.9,0.475],[0.18,-2.5,0.435],[0.13,-2.2,0.435]], mat.wireOrange, "tendons", 0.008, [0.1,-0.15,0.25]);
}

function createFingerTendonRoutes() {
  // External routing shows a plausible concept path from fingertip tracks back to each actuator.
  const paths = [
    [[-0.38, 1.78, 0.15], [-0.39, 1.14, 0.22], [-0.38, 0.55, 0.2], [-0.42, -0.28, 0.24], [-0.45, -1.32, 0.4]],
    [[-0.12, 1.92, 0.16], [-0.14, 1.25, 0.22], [-0.12, 0.4, 0.23], [-0.18, -0.42, 0.25], [-0.225, -1.31, 0.4]],
    [[0.12, 1.87, 0.15], [0.12, 1.1, 0.22], [0.13, 0.36, 0.23], [0.12, -0.48, 0.25], [0, -1.31, 0.4]],
    [[0.36, 1.74, 0.15], [0.35, 1.06, 0.22], [0.36, 0.34, 0.23], [0.34, -0.46, 0.25], [0.225, -1.31, 0.4]],
    [[0.15, 0.65, 0.19], [0.34, 0.42, 0.25], [0.43, 0.0, 0.25], [0.45, -0.52, 0.27], [0.45, -1.29, 0.4]]
  ];
  paths.forEach((path, index) => addLine(handRoot, path, index % 2 ? mat.wireTeal : mat.tendon, "tendons", index === 4 ? 0.018 : 0.013, [0, 0, 0.3]));
}

function buildModel() {
  // Lighting and floor: studio-like, but light enough to inspect each component.
  scene.add(new THREE.HemisphereLight(0xf7fcff, 0xb7c5ce, 2.0));
  const keyLight = new THREE.DirectionalLight(0xffffff, 3.05);
  keyLight.position.set(3.8, 5.5, 5);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(1024, 1024);
  keyLight.shadow.camera.left = -4;
  keyLight.shadow.camera.right = 4;
  keyLight.shadow.camera.top = 5;
  keyLight.shadow.camera.bottom = -5;
  keyLight.shadow.bias = -0.0006;
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0xb0d7dc, 1.45);
  fillLight.position.set(-4, 1.2, 2.5);
  scene.add(fillLight);
  const rimLight = new THREE.DirectionalLight(0xffffff, 2.2);
  rimLight.position.set(-1.3, 4, -4.5);
  scene.add(rimLight);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 80),
    new THREE.ShadowMaterial({ color: 0x8d9eaa, opacity: 0.15 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -2.52;
  floor.receiveShadow = true;
  scene.add(floor);

  makePalmShell();
  createFinger("index", "Index", -0.385, [0.49, 0.39, 0.31], 0.095, 0.02);
  createFinger("middle", "Middle", -0.125, [0.56, 0.43, 0.32], 0.103, 0.005);
  createFinger("ring", "Ring", 0.14, [0.52, 0.4, 0.3], 0.099, -0.015);
  createFinger("little", "Little", 0.385, [0.44, 0.34, 0.26], 0.088, -0.05);
  createThumb();
  createActuatorsAndCuff();
  createElectronics();
  createForearmAndEmgPads();
  createFingerTendonRoutes();

  createLabel("ESP32 MOTOR CTRL", [-0.02, -2.3, 0.75], "#1d776d");
  createLabel("EMG ELECTRODES", [0.66, -4.34, 0.61], "#1d776d");


  // Slight natural yaw gives the shell and joint depth.
  handRoot.rotation.y = -0.12;
  modelReady = true;
  setPose("open");
  applyLayerVisibility();
  updateVisibleParts();
}

function initRenderer() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setSize(mount.clientWidth || 800, mount.clientHeight || 540, false);
  renderer.domElement.setAttribute("aria-label", "Three-dimensional hand model. Drag to rotate and scroll to zoom.");
  mount.appendChild(renderer.domElement);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.enablePan = true;
  controls.minDistance = 4.2;
  controls.maxDistance = 15.5;
  controls.minPolarAngle = 0.25;
  controls.maxPolarAngle = Math.PI * 0.88;
  controls.target.set(0, -1.05, 0);
  controls.update();
  const resize = () => {
    const width = Math.max(1, mount.clientWidth);
    const height = Math.max(1, mount.clientHeight);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  };
  if ("ResizeObserver" in window) new ResizeObserver(resize).observe(mount);
  else window.addEventListener("resize", resize);
  renderer.setAnimationLoop(animate);
}

function getPoseValues(name) {
  const poses = {
    open: {
      index: [0, 0, 0], middle: [0, 0, 0], ring: [0, 0, 0], little: [0, 0, 0], thumb: [0, 0, 0]
    },
    fist: {
      index: [0.14, 1.0, 1.06], middle: [0.16, 1.02, 1.1], ring: [0.18, 1.03, 1.1], little: [0.2, 1.0, 1.0], thumb: [0.58, 0.76, 0.72]
    },
    pinch: {
      index: [0.08, 0.62, 1.15], middle: [0.2, 1.02, 1.12], ring: [0.21, 1.06, 1.12], little: [0.22, 1.04, 1.0], thumb: [0.98, 0.55, 0.28]
    },
    point: {
      index: [0, 0, 0], middle: [0.2, 1.02, 1.12], ring: [0.21, 1.06, 1.12], little: [0.22, 1.04, 1.0], thumb: [0.38, 0.58, 0.38]
    }
  };
  return poses[name] || poses.open;
}

function setPose(name) {
  currentPose = name;
  const pose = getPoseValues(name);
  fingers.forEach(finger => {
    const values = pose[finger.key] || [0, 0, 0];
    finger.root.rotation.z = finger.baseAngle + values[0];
    finger.joints.forEach((joint, index) => {
      joint.rotation.z = values[index + 1] ?? values[2] ?? 0;
    });
  });
  const servoPose = {
    open: [0, 0, 0, 0, 0],
    fist: [0.95, 1, 1, 0.95, 0.78],
    pinch: [0.62, 0.9, 0.93, 0.88, 0.72],
    point: [0, 0.92, 0.95, 0.88, 0.42]
  }[name] || [0, 0, 0, 0, 0];
  servoHorns.forEach((horn, index) => {
    if (horn) horn.rotation.z = horn.userData.baseHornRotationZ + servoPose[index] * 0.9;
  });
  $$$(".pose-card").forEach(card => {
    const selected = card.dataset.pose === name;
    card.classList.toggle("selected", selected);
    card.setAttribute("aria-pressed", String(selected));
  });
  const labels = { open: "OPEN HAND", fist: "POWER GRIP", pinch: "PRECISION PINCH", point: "POINT" };
  $("#pose-status-label").textContent = "POSE: " + (labels[name] || "CUSTOM EMG");
  $("#pose-status").style.background = name === "open" ? "#2fbca9" : "#dfa05d";
  updatePoseStatus(name);
}

function setProportionalGrip(level) {
  const amount = clamp((level - thresholdLevel) / Math.max(1, 100 - thresholdLevel), 0, 1);
  applyGripAmount(amount, level < thresholdLevel ? "POSE: REST / OPEN" : "POSE: PROPORTIONAL GRIP");
}

function applyGripAmount(amount, statusLabel = "POSE: PROPORTIONAL GRIP") {
  currentPose = "emg";
  amount = clamp(amount, 0, 1);
  latestGrip = Math.round(amount * 100);
  fingers.forEach(finger => {
    let baseFlex = 0.12 * amount;
    let first = 1.05 * amount;
    let second = 1.12 * amount;
    if (finger.key === "thumb") {
      baseFlex = 0.7 * amount;
      first = 0.62 * amount;
      second = 0.45 * amount;
    }
    finger.root.rotation.z = finger.baseAngle + baseFlex;
    finger.joints.forEach((joint, index) => joint.rotation.z = index === 0 ? first : second);
  });
  servoHorns.forEach((horn, index) => {
    if (horn) horn.rotation.z = horn.userData.baseHornRotationZ + amount * (index === 4 ? 0.78 : 0.92);
  });
  $$$(".pose-card").forEach(card => {
    card.classList.remove("selected");
    card.setAttribute("aria-pressed", "false");
  });
  $("#pose-status-label").textContent = statusLabel;
  $("#pose-status").style.background = amount < 0.04 ? "#2fbca9" : "#dfa05d";
  $("#grip-value").textContent = latestGrip + "%";
}

function updatePoseStatus(name) {
  const display = { open: 0, fist: 100, pinch: 62, point: 45 };
  latestGrip = display[name] ?? latestGrip;
  $("#grip-value").textContent = latestGrip + "%";
}

function applyLayerVisibility() {
  Object.keys(layerObjects).forEach(layer => {
    const input = document.querySelector('[data-layer="' + layer + '"]');
    const enabled = input ? input.checked : true;
    layerObjects[layer].forEach(object => {
      object.visible = enabled;
    });
  });
  // The physical floor and stand are not assembly layers and remain visible.
  updateVisibleParts();
}

function updateVisibleParts() {
  const visible = Object.values(layerObjects).flat().filter(object => object.visible).length;
  $("#visible-parts").textContent = visible;
}

function animateExplode(delta) {
  explodeAmount = THREE.MathUtils.damp(explodeAmount, explodeTarget, 4.5, delta);
  Object.values(layerObjects).flat().forEach(object => {
    if (!object.userData.basePosition || !object.userData.explodeVector) return;
    const base = object.userData.basePosition;
    const offset = object.userData.explodeVector.clone().multiplyScalar(explodeAmount);
    object.position.copy(base).add(offset);
  });
}

function setXray(enabled) {
  xrayEnabled = enabled;
  $("#xray-button").setAttribute("aria-pressed", String(enabled));
  $("#xray-button").innerHTML = '<span class="button-glyph">◉</span> ' + (enabled ? "X-ray on" : "X-ray");
  layerObjects.shell.forEach(object => {
    if (!object.material) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach(material => {
      if (!material.userData.originalOpacity) material.userData.originalOpacity = material.opacity ?? 1;
      material.transparent = enabled || (material.userData.originalTransparent ?? false);
      material.opacity = enabled ? 0.24 : material.userData.originalOpacity;
      if (material.userData.originalTransparent === undefined) material.userData.originalTransparent = false;
      material.depthWrite = !enabled;
      material.needsUpdate = true;
    });
  });
  // Keep a visible hint that the transparent shell can be turned off independently.
  if (enabled) {
    $("#xray-button").classList.add("active");
  } else {
    $("#xray-button").classList.remove("active");
  }
}

function setRangeFill(input) {
  const min = Number(input.min || 0);
  const max = Number(input.max || 100);
  const percent = (Number(input.value) - min) / (max - min) * 100;
  input.style.background = "linear-gradient(to right, #177f77 0%, #42c5b4 " + percent + "%, #e3eaee " + percent + "%, #e3eaee 100%)";
}

function updateSignalReadouts() {
  const level = displayedEmgLevel;
  if (hardwareMode && latestHardware) {
    latestVoltage = Number.isFinite(latestHardware.voltage) ? latestHardware.voltage : 0;
    latestGrip = Math.round(clamp(latestHardware.grip || 0, 0, 1) * 100);
  } else {
    latestVoltage = 0.08 + (level / 100) * 2.65;
    latestGrip = level < thresholdLevel ? 0 : Math.round((level - thresholdLevel) / Math.max(1, 100 - thresholdLevel) * 100);
  }
  const voltage = latestVoltage.toFixed(2);
  $("#emg-voltage").innerHTML = voltage + ' <small>V</small>';
  $("#emg-value-small").textContent = voltage + " V";
  $("#signal-stat-voltage").textContent = voltage + " V";
  $("#signal-stat-level").textContent = Math.round(level) + "%";
  $("#signal-stat-grip").textContent = latestGrip + "%";
  const state = hardwareMode && latestHardware
    ? (latestHardware.active ? "CONTRACTED" : "RESTING")
    : (level < thresholdLevel ? "RESTING" : level < thresholdLevel + 23 ? "ACTIVATING" : "CONTRACTED");
  $("#signal-state").textContent = state;
  $("#signal-state").classList.toggle("active", hardwareMode ? Boolean(latestHardware?.active) : level >= thresholdLevel);
  $("#signal-stat-state").textContent = state;
  $("#emg-meter").style.width = level + "%";
  $("#grip-value").textContent = latestGrip + "%";
  $("#emg-slider-value").textContent = Math.round(level);
  $("#emg-slider").value = Math.round(hardwareMode ? level : baseEmgLevel);
  $("#emg-slider-large").value = Math.round(hardwareMode ? level : baseEmgLevel);
  $$(".range-control").forEach(input => {
    input.disabled = hardwareMode && input.id !== "threshold-slider";
    setRangeFill(input);
  });
  $("#threshold-slider").disabled = hardwareMode;
  $("#emg-auto").disabled = hardwareMode;
  $$(".range-control").forEach(input => input.classList.toggle("hardware-locked", hardwareMode));
}

function handleEmgInput(value) {
  baseEmgLevel = clamp(Number(value), 0, 100);
  displayedEmgLevel = baseEmgLevel;
  currentPose = "emg";
  setProportionalGrip(displayedEmgLevel);
  updateSignalReadouts();
  addSignalSample(displayedEmgLevel);
}

function updateHardwareStatus(connected) {
  $("#hardware-status").textContent = connected ? "ESP32 CONNECTED" : "HARDWARE OFFLINE";
  $("#serial-connect").setAttribute("aria-pressed", String(connected));
  $("#serial-connect").innerHTML = connected
    ? '<span class="connect-glyph">↔</span> Disconnect ESP32'
    : '<span class="connect-glyph">↔</span> Connect ESP32';
  $("#signal-stream-status").innerHTML = '<i></i> ' + (connected ? "LIVE ESP32 STREAM" : "SIMULATED STREAM");
  $$(".pose-card").forEach(card => {
    card.disabled = connected;
    card.title = connected ? "Gesture presets are visual demos; live hardware follows EMG input" : "";
  });
  $("#emg-source-note").textContent = connected
    ? "USB serial connected. Live four-channel EMG data is coming from the main ESP32."
    : "Synthetic signal until USB connection. Live mode reads four conditioned EMG envelope channels.";
  $("#simulate-flex").innerHTML = connected ? "Resume EMG control <span>↗</span>" : 'Simulate contraction <span>↗</span>';
  $("#simulate-rest").textContent = connected ? "Force open" : "Rest";
  if (!connected) latestHardware = null;
}

function parseHardwareLine(line) {
  if (!line || !line.includes("raw=") || !line.includes("grip=")) return;
  const values = {};
  line.trim().split(",").forEach(part => {
    const separator = part.indexOf("=");
    if (separator < 1) return;
    values[part.slice(0, separator).trim()] = part.slice(separator + 1).trim();
  });

  const grip = Number(values.grip);
  if (!Number.isFinite(grip)) return;
  const voltage = Number(values.env_est_V);
  const level = Number(values.level);
  const emg = [1, 2, 3, 4].map(i => {
    const value = Number(values["emg" + i]);
    return Number.isFinite(value) ? clamp(value, 0, 1) : null;
  });

  latestHardware = {
    raw: Number(values.raw),
    filtered: Number(values.filtered),
    baseline: Number(values.baseline),
    voltage: Number.isFinite(voltage) ? voltage : 0,
    grip: clamp(grip, 0, 1),
    active: Number(values.active) === 1,
    emg,
    level: Number.isFinite(level) ? clamp(level, 0, 100) : null,
    mode: values.mode || "AUTO"
  };
  hardwareMode = true;
  const delta = Number.isFinite(latestHardware.filtered) && Number.isFinite(latestHardware.baseline)
    ? latestHardware.filtered - latestHardware.baseline
    : 0;
  displayedEmgLevel = Number.isFinite(latestHardware.level)
    ? latestHardware.level
    : clamp(((delta - 95) / 950) * 100, 0, 100);
  applyGripAmount(latestHardware.grip, latestHardware.active ? "POSE: LIVE EMG GRIP" : "POSE: LIVE EMG / REST");
  addSignalSample(displayedEmgLevel);
  updateSignalReadouts();
  if ($("#signal-pane").classList.contains("active")) drawSignalChart();
}

async function connectSerial() {
  if (!("serial" in navigator) || !window.isSecureContext) {
    alert("USB serial needs Chrome or Edge and a secure page (HTTPS or localhost). You can still use simulation mode.");
    return;
  }
  try {
    serialPort = await navigator.serial.requestPort();
    await serialPort.open({ baudRate: 115200 });
    serialReader = serialPort.readable.getReader();
    serialWriter = serialPort.writable.getWriter();
    serialConnected = true;
    hardwareMode = true;
    latestHardware = null;
    updateHardwareStatus(true);

    const decoder = new TextDecoder();
    let buffer = "";
    while (serialConnected) {
      const result = await serialReader.read();
      if (result.done) break;
      buffer += decoder.decode(result.value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      lines.forEach(parseHardwareLine);
    }
  } catch (error) {
    if (error?.name !== "NotFoundError") {
      console.error("ESP32 serial connection failed:", error);
      alert("Could not connect to the ESP32. Check the USB cable, COM port and 115200 baud firmware.");
    }
  } finally {
    serialConnected = false;
    if (serialReader) {
      try { serialReader.releaseLock(); } catch (_) {}
    }
    if (serialWriter) {
      try { serialWriter.releaseLock(); } catch (_) {}
    }
    if (serialPort) {
      try { await serialPort.close(); } catch (_) {}
    }
    serialReader = null;
    serialWriter = null;
    serialPort = null;
    hardwareMode = false;
    latestHardware = null;
    updateHardwareStatus(false);
    setPose("open");
    updateSignalReadouts();
  }
}

async function disconnectSerial() {
  serialConnected = false;
  if (serialReader) {
    try { await serialReader.cancel(); } catch (_) {}
  }
}

async function sendSerialCommand(command) {
  if (!hardwareMode || !serialWriter) return false;
  try {
    await serialWriter.write(new TextEncoder().encode(command + "\n"));
    return true;
  } catch (error) {
    console.error("Could not send command to ESP32:", error);
    return false;
  }
}

function addSignalSample(level) {
  const noise = autoSignal ? (Math.random() - 0.5) * 5.5 + Math.sin(sampleCount * 0.43) * 3.2 : 0;
  const sample = clamp(level + noise, 0, 100);
  signalHistory.push(sample);
  if (signalHistory.length > 120) signalHistory.shift();
  sampleCount++;
}

function drawSignalChart() {
  const canvas = $("#emg-chart");
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.floor(rect.width * dpr);
  const height = Math.floor(rect.height * dpr);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = rect.width;
  const h = rect.height;
  ctx.clearRect(0, 0, w, h);
  const pad = { left: 38, right: 12, top: 14, bottom: 25 };
  const chartW = w - pad.left - pad.right;
  const chartH = h - pad.top - pad.bottom;
  ctx.font = "9px 'DM Mono', monospace";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + chartH * i / 4;
    ctx.strokeStyle = "#eaf0f2";
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(w - pad.right, y);
    ctx.stroke();
    ctx.fillStyle = "#96a5ae";
    ctx.fillText(String(100 - i * 25), 4, y + 3);
  }
  for (let i = 0; i <= 5; i++) {
    const x = pad.left + chartW * i / 5;
    ctx.strokeStyle = "#f0f3f5";
    ctx.beginPath();
    ctx.moveTo(x, pad.top);
    ctx.lineTo(x, pad.top + chartH);
    ctx.stroke();
    ctx.fillStyle = "#a0adb5";
    ctx.fillText("-" + (5 - i) + "s", x - 9, h - 7);
  }
  const yThreshold = pad.top + chartH * (1 - thresholdLevel / 100);
  ctx.strokeStyle = "#d7a05d";
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.moveTo(pad.left, yThreshold);
  ctx.lineTo(w - pad.right, yThreshold);
  ctx.stroke();
  ctx.setLineDash([]);
  if (signalHistory.length > 1) {
    const points = signalHistory.map((v, i) => ({
      x: pad.left + chartW * i / Math.max(1, 119),
      y: pad.top + chartH * (1 - v / 100)
    }));
    ctx.beginPath();
    points.forEach((point, i) => i === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y));
    ctx.lineTo(points[points.length - 1].x, pad.top + chartH);
    ctx.lineTo(points[0].x, pad.top + chartH);
    ctx.closePath();
    const gradient = ctx.createLinearGradient(0, pad.top, 0, pad.top + chartH);
    gradient.addColorStop(0, "rgba(42,178,160,0.18)");
    gradient.addColorStop(1, "rgba(42,178,160,0.015)");
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.beginPath();
    points.forEach((point, i) => i === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y));
    ctx.strokeStyle = "#2aa997";
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();
    const last = points[points.length - 1];
    ctx.fillStyle = "#2aa997";
    ctx.beginPath();
    ctx.arc(last.x, last.y, 3.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#d9f2ed";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(last.x, last.y, 6, 0, Math.PI * 2);
    ctx.stroke();
  }
  $("#chart-sample-count").textContent = sampleCount + " SAMPLES";
}

function animate(time, deltaArg) {
  const delta = Math.min(deltaArg || clock.getDelta(), 0.04);
  if (controls) controls.update();
  animateExplode(delta);
  if (hardwareMode && latestHardware) {
    if (time - lastUiPaint > 90) {
      displayedEmgLevel = clamp((latestHardware.voltage / 3.3) * 100, 0, 100);
      addSignalSample(displayedEmgLevel);
      updateSignalReadouts();
      lastUiPaint = time;
      if ($("#signal-pane").classList.contains("active")) drawSignalChart();
    }
  } else if (autoSignal && time - lastUiPaint > 90) {
    displayedEmgLevel = clamp(baseEmgLevel + Math.sin(time * 0.0018) * 1.8 + (Math.random() - 0.5) * 1.4, 0, 100);
    addSignalSample(displayedEmgLevel);
    updateSignalReadouts();
    if (currentPose === "emg") setProportionalGrip(displayedEmgLevel);
    lastUiPaint = time;
    if ($("#signal-pane").classList.contains("active")) drawSignalChart();
  } else if (time - lastUiPaint > 160) {
    addSignalSample(displayedEmgLevel);
    lastUiPaint = time;
    if ($("#signal-pane").classList.contains("active")) drawSignalChart();
  }
  if (renderer) renderer.render(scene, camera);
}

function setActivePane(target) {
  $$(".main-tab").forEach(button => button.classList.toggle("active", button.dataset.paneTarget === target));
  $$(".workspace-pane").forEach(pane => pane.classList.toggle("active", pane.dataset.pane === target));
  if (target === "signal-pane") {
    requestAnimationFrame(drawSignalChart);
  }
}

function resetCamera() {
  camera.position.set(3.25, -0.1, 11.3);
  controls.target.set(0, -1.05, 0);
  controls.update();
}

function bindUi() {
  $$(".main-tab").forEach(button => button.addEventListener("click", () => setActivePane(button.dataset.paneTarget)));
  $$$(".pose-card").forEach(button => button.addEventListener("click", () => {
    setPose(button.dataset.pose);
    if (button.dataset.pose !== "open") baseEmgLevel = Math.max(baseEmgLevel, button.dataset.pose === "fist" ? 85 : 53);
    else baseEmgLevel = 8;
    displayedEmgLevel = baseEmgLevel;
    updateSignalReadouts();
  }));

  $$(".layer-row input").forEach(input => input.addEventListener("change", applyLayerVisibility));
  $("#show-all-layers").addEventListener("click", () => {
    $$(".layer-row input").forEach(input => { input.checked = true; });
    applyLayerVisibility();
  });
  $("#explode-button").addEventListener("click", () => {
    isExploded = !isExploded;
    explodeTarget = isExploded ? 1 : 0;
    $("#explode-button").setAttribute("aria-pressed", String(isExploded));
    $("#explode-button").innerHTML = '<span class="button-glyph">⤢</span> ' + (isExploded ? "Reassemble layers" : "Explode layers");
  });
  $("#xray-button").addEventListener("click", () => setXray(!xrayEnabled));
  $("#reset-view").addEventListener("click", resetCamera);
  $("#focus-hand").addEventListener("click", resetCamera);
  $("#serial-connect").addEventListener("click", async () => {
    if (serialPort || serialConnected) await disconnectSerial();
    else await connectSerial();
  });

  const rangeInputs = [$("#emg-slider"), $("#emg-slider-large")];
  rangeInputs.forEach(input => input.addEventListener("input", event => handleEmgInput(event.target.value)));
  $("#threshold-slider").addEventListener("input", event => {
    thresholdLevel = Number(event.target.value);
    $("#threshold-value").textContent = thresholdLevel + "%";
    updateSignalReadouts();
    drawSignalChart();
  });
  $("#emg-auto").addEventListener("click", () => {
    autoSignal = !autoSignal;
    $("#emg-auto").setAttribute("aria-pressed", String(autoSignal));
    $("#emg-auto").innerHTML = (autoSignal ? "AUTO SIGNAL " : "SIGNAL HOLD ") + '<span class="tiny-switch"></span>';
  });
  $("#simulate-flex").addEventListener("click", async () => {
    if (hardwareMode) {
      await sendSerialCommand("a");
      return;
    }
    baseEmgLevel = 78;
    displayedEmgLevel = 78;
    handleEmgInput(78);
  });
  $("#simulate-rest").addEventListener("click", async () => {
    if (hardwareMode) {
      await sendSerialCommand("o");
      applyGripAmount(0, "POSE: FORCE OPEN COMMAND");
      if (latestHardware) latestHardware = { ...latestHardware, grip: 0, active: false };
      updateSignalReadouts();
      return;
    }
    baseEmgLevel = 4;
    displayedEmgLevel = 4;
    handleEmgInput(4);
  });
  window.addEventListener("resize", drawSignalChart);
  $$(".range-control").forEach(setRangeFill);
  updateHardwareStatus(false);
}

try {
  initRenderer();
  buildModel();
  bindUi();
  updateSignalReadouts();
  for (let i = 0; i < 120; i++) {
    const t = i / 120;
    addSignalSample(12 + Math.sin(t * Math.PI * 10) * 3 + (Math.random() - 0.5) * 2);
  }
  drawSignalChart();
} catch (error) {
  console.error("NeuroGrip simulation initialization failed:", error);
  const errorPanel = $("#model-error");
  errorPanel.hidden = false;
}

