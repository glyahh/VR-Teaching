import * as THREE from 'three';

export function createStageViewport(canvas, stage) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.03;
  renderer.localClippingEnabled = true;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;

  let active = null;
  let width = 0;
  let height = 0;
  let previous = performance.now();
  let frameRequest = 0;
  const markerSizes = new WeakMap();
  const measureMarkers = new ResizeObserver(entries => {
    for (const { target, borderBoxSize: [box] } of entries) {
      if (box?.inlineSize) markerSizes.set(target, box);
    }
  });

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    if (w !== width || h !== height) {
      width = w;
      height = h;
      renderer.setSize(width, height, false);
    }
    active?.resize(width / height);
  }
  const stageSize = new ResizeObserver(resize);
  stageSize.observe(stage);

  function schedule() {
    if (active && !frameRequest) frameRequest = requestAnimationFrame(frame);
  }

  function frame(now) {
    frameRequest = 0;
    const delta = Math.min(0.12, Math.max(0, (now - previous) / 1000));
    previous = now;
    active?.paint(delta, now);
    schedule();
  }

  return {
    renderer,
    dispose() {
      active = null;
      cancelAnimationFrame(frameRequest);
      stageSize.disconnect();
      measureMarkers.disconnect();
      renderer.dispose();
      renderer.forceContextLoss();
    },

    capture(snapshot, camera) {
      if (!active || !canvas.width || !canvas.height) return false;
      const context = snapshot.getContext('2d');
      if (!context) return false;
      const scale = Math.min(1, 1660 / canvas.width, 1000 / canvas.height);
      snapshot.width = Math.max(1, Math.round(canvas.width * scale));
      snapshot.height = Math.max(1, Math.round(canvas.height * scale));
      active.render(camera);
      context.drawImage(canvas, 0, 0, snapshot.width, snapshot.height);
      return true;
    },

    register(camera, scene, draw) {
      let dirty = true;
      let shadows = true;
      const raycaster = new THREE.Raycaster();
      const cursor = new THREE.Vector2();
      const projected = new THREE.Vector3();

      const view = {
        resize(aspect) {
          if (camera.isOrthographicCamera) {
            const half = Math.max(33.5, 48 / aspect);
            camera.left = -half * aspect;
            camera.right = half * aspect;
            camera.top = half;
            camera.bottom = -half;
          } else camera.aspect = aspect;
          camera.updateProjectionMatrix();
          dirty = true;
        },
        paint(delta, now) {
          draw(delta, now, dirty);
          if (dirty) view.render();
        },
        render(look = camera) {
          renderer.shadowMap.needsUpdate = shadows;
          renderer.render(scene, look);
          dirty = shadows = false;
        },
      };

      return {
        activate() {
          active = view;
          dirty = shadows = true;
          resize();
          previous = performance.now();
          view.paint(0, previous);
          schedule();
        },
        deactivate() {
          if (active !== view) return;
          active = null;
          cancelAnimationFrame(frameRequest);
          frameRequest = 0;
        },
        invalidate: () => { dirty = true; },
        updateShadows: () => { shadows = dirty = true; },
        pick(event) {
          const bounds = canvas.getBoundingClientRect();
          cursor.set((event.clientX - bounds.left) / bounds.width * 2 - 1,
            1 - (event.clientY - bounds.top) / bounds.height * 2);
          camera.updateMatrixWorld();
          raycaster.setFromCamera(cursor, camera);
          return raycaster;
        },
        place(element, anchor, visible = true) {
          if (!markerSizes.has(element)) {
            markerSizes.set(element, { inlineSize: 0, blockSize: 0 });
            measureMarkers.observe(element);
          }
          projected.copy(anchor).project(camera);
          const left = (projected.x + 1) / 2 * width;
          const top = (1 - projected.y) / 2 * height;
          const { inlineSize, blockSize } = markerSizes.get(element);
          visible &&= Math.abs(projected.x) < 0.97 && Math.abs(projected.y) < 0.92 &&
            projected.z > -1 && projected.z < 1 &&
            left >= inlineSize / 2 && left + inlineSize / 2 <= width && top >= blockSize;
          element.hidden = !visible;
          if (visible) {
            element.style.left = left + 'px';
            element.style.top = top + 'px';
          }
        },
      };
    },
  };
}
