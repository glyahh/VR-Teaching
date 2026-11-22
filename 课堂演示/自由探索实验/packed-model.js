import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export async function loadModel(source) {
  const packed = await fetch(source);
  const bytes = await new Response(packed.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  const model = await new GLTFLoader().parseAsync(bytes, '');
  return model.scene;
}
