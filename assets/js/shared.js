/* =====================================================================
   shared.js — Reusable building blocks for all pages.
   Loaded via <script src="assets/js/shared.js"></script> in every page.

   Exposes a global `Wiskamp` namespace with:
     - palette(t)            : peacock color at parameter t in [0,1]
     - softCircleTexture()   : THREE.CanvasTexture for round particles
     - ATTRACTORS            : the 5 strange attractor definitions
     - genTrail(att, N)      : generate a trail of N points for attractor `att`
     - createPointsMaterial  : helper for THREE.PointsMaterial with our defaults
   ===================================================================== */

window.Wiskamp = (function(){

  /*
    PEACOCK PALETTE
    Maps a parameter t in [0,1] to an [r,g,b] color in [0,1] each.
    Deep teal -> cyan -> warm gold -> bright cream highlight.
    Used for both attractor trails and ambient drifters.
  */
  function palette(t){
    if (t < 0.45) {
      const u = t / 0.45;
      return [0.05 + u*0.08, 0.32 + u*0.55, 0.42 + u*0.40];
    } else if (t < 0.85) {
      const u = (t - 0.45) / 0.40;
      return [0.13 + u*0.78, 0.87 - u*0.32, 0.82 - u*0.48];
    } else {
      const u = (t - 0.85) / 0.15;
      return [0.91 + u*0.09, 0.55 + u*0.40, 0.34 + u*0.46];
    }
  }

  /*
    SOFT CIRCLE TEXTURE
    Generates a 128x128 radial-gradient canvas, returned as a THREE.CanvasTexture.
    Used as the `map` for PointsMaterial so points render as soft round dots
    instead of hard square sprites. Critical for the OLED-glow look.
  */
  function softCircleTexture(){
    const size = 128;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    const cx = size/2, cy = size/2;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, size/2);
    grad.addColorStop(0.00, 'rgba(255,255,255,1.0)');
    grad.addColorStop(0.20, 'rgba(255,255,255,0.85)');
    grad.addColorStop(0.50, 'rgba(255,255,255,0.30)');
    grad.addColorStop(0.80, 'rgba(255,255,255,0.05)');
    grad.addColorStop(1.00, 'rgba(255,255,255,0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(c);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    return tex;
  }

  /*
    ATTRACTOR DEFINITIONS
    Each attractor has:
      - name          : display label
      - dt            : integration time step
      - scale         : world-space scale factor
      - defaultSeed   : known-good starting point in phase space
      - rotX/Y/Z      : per-axis rotation rates (some attractors need dampened wobble)
      - step(x,y,z)   : returns [dx, dy, dz] velocity vector at the given point
  */
  const ATTRACTORS = {
    halvorsen: {
      name: 'HALVORSEN', dt: 0.005, scale: 0.42, defaultSeed: [-1, 0, 0],
      rotX: 0.0006, rotY: 0.0018, rotZ: 0.0003,
      step: function(x,y,z){ const a = 1.4; return [-a*x - 4*y - 4*z - y*y, -a*y - 4*z - 4*x - z*z, -a*z - 4*x - 4*y - x*x]; }
    },
    lorenz: {
      name: 'LORENZ', dt: 0.006, scale: 0.24, defaultSeed: [0.1, 0, 0],
      rotX: 0.0011, rotY: 0.0028, rotZ: 0.0005,
      step: function(x,y,z){ return [10*(y-x), x*(28-z) - y, x*y - (8/3)*z]; }
    },
    aizawa: {
      name: 'AIZAWA', dt: 0.012, scale: 3.6, defaultSeed: [0.1, 1, 0],
      rotX: 0.0008, rotY: 0.0024, rotZ: 0.0002,
      step: function(x,y,z){ return [(z-0.7)*x - 3.5*y, 3.5*x + (z-0.7)*y, 0.6 + 0.95*z - z*z*z/3 - (x*x + y*y)*(1 + 0.25*z) + 0.1*z*x*x*x]; }
    },
    thomas: {
      name: 'THOMAS', dt: 0.04, scale: 1.9, defaultSeed: [1, 1, 1],
      rotX: 0.0010, rotY: 0.0026, rotZ: 0.0003,
      step: function(x,y,z){ const b = 0.208186; return [Math.sin(y) - b*x, Math.sin(z) - b*y, Math.sin(x) - b*z]; }
    },
    chen: {
      name: 'CHEN', dt: 0.0015, scale: 0.18, defaultSeed: [5, 10, 20],
      rotX: 0.0011, rotY: 0.0028, rotZ: 0.0005,
      step: function(x,y,z){ return [35*(y - x), (28-35)*x - x*z + 28*y, x*y - 3*z]; }
    }
  };

  /*
    TRAIL GENERATION
    Generates N points along an attractor's trajectory, recentered so the centroid
    sits at the origin (this ensures rotation looks natural).
    Returns { pts, head, centroid }.
  */
  function genTrail(att, N){
    const pts = new Float32Array(N * 3);
    let x = att.defaultSeed[0], y = att.defaultSeed[1], z = att.defaultSeed[2];

    // Robust warmup: detect explosions (NaN, infinity, gross outliers) and reseed if needed.
    for (let i = 0; i < 1200; i++) {
      const d = att.step(x, y, z);
      x += d[0]*att.dt; y += d[1]*att.dt; z += d[2]*att.dt;
      if (!isFinite(x) || !isFinite(y) || !isFinite(z) || Math.abs(x) > 1000 || Math.abs(y) > 1000 || Math.abs(z) > 1000) {
        x = att.defaultSeed[0] + (Math.random()-0.5)*0.4;
        y = att.defaultSeed[1] + (Math.random()-0.5)*0.4;
        z = att.defaultSeed[2] + (Math.random()-0.5)*0.4;
      }
    }
    // Stuck-detection: if trajectory isn't moving meaningfully, perturb and re-warmup.
    let px = x, py = y, pz = z;
    for (let i = 0; i < 50; i++) {
      const d = att.step(x, y, z);
      x += d[0]*att.dt; y += d[1]*att.dt; z += d[2]*att.dt;
    }
    if (Math.abs(x-px) + Math.abs(y-py) + Math.abs(z-pz) < 0.001) {
      x += 0.5; y += 0.5; z += 0.3;
      for (let i = 0; i < 600; i++) {
        const d = att.step(x, y, z);
        x += d[0]*att.dt; y += d[1]*att.dt; z += d[2]*att.dt;
      }
    }
    // Generate trail in scaled world coords
    for (let i = 0; i < N; i++) {
      const d = att.step(x, y, z);
      x += d[0]*att.dt; y += d[1]*att.dt; z += d[2]*att.dt;
      pts[i*3]     = x * att.scale;
      pts[i*3 + 1] = y * att.scale;
      pts[i*3 + 2] = z * att.scale;
    }
    // Recenter to centroid so rotation pivots through center of mass
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < N; i++) {
      cx += pts[i*3]; cy += pts[i*3 + 1]; cz += pts[i*3 + 2];
    }
    cx /= N; cy /= N; cz /= N;
    for (let i = 0; i < N; i++) {
      pts[i*3]     -= cx; pts[i*3 + 1] -= cy; pts[i*3 + 2] -= cz;
    }
    return { pts, head: [x, y, z], centroid: [cx, cy, cz] };
  }

  /*
    POINTS MATERIAL HELPER
    Creates a PointsMaterial with our standard settings:
    soft circle texture, additive blending, vertex colors.
  */
  function createPointsMaterial(softTex, size, opacity){
    return new THREE.PointsMaterial({
      size: size,
      vertexColors: true,
      transparent: true,
      opacity: opacity,
      sizeAttenuation: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      map: softTex,
      alphaTest: 0.001
    });
  }

  /*
    AMBIENT DRIFT
    Reusable 2D ambient particle layer. Looks for <canvas id="ambient-canvas">
    and animates softly-glowing drifters in the peacock palette.
    Call once after DOM ready: Wiskamp.initAmbientDrift();
  */
  function initAmbientDrift(opts){
    opts = opts || {};
    const NUM = opts.num || 30;
    const tRange = opts.paletteRange || [0, 0.6];
    const canvas = document.getElementById('ambient-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    function resize(){
      const dpr = Math.min(window.devicePixelRatio, 2);
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener('resize', resize);

    const drifters = [];
    for (let i = 0; i < NUM; i++) {
      const tt = tRange[0] + Math.random() * (tRange[1] - tRange[0]);
      const c = palette(tt);
      drifters.push({
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        vx: (Math.random() - 0.5) * 1.2,
        vy: (Math.random() - 0.5) * 0.8,
        r: 1.2 + Math.random() * 1.8,
        cr: Math.round(c[0] * 255),
        cg: Math.round(c[1] * 255),
        cb: Math.round(c[2] * 255),
        alpha: 0.35 + Math.random() * 0.45
      });
    }

    function tick(){
      requestAnimationFrame(tick);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < drifters.length; i++) {
        const d = drifters[i];
        d.x += d.vx;
        d.y += d.vy;
        d.vx += (Math.random() - 0.5) * 0.04;
        d.vy += (Math.random() - 0.5) * 0.025;
        d.vx *= 0.998;
        d.vy *= 0.998;
        const speed = Math.sqrt(d.vx * d.vx + d.vy * d.vy);
        if (speed < 0.15) {
          const ang = Math.random() * Math.PI * 2;
          d.vx += Math.cos(ang) * 0.3;
          d.vy += Math.sin(ang) * 0.2;
        }
        if (speed > 1.8) {
          d.vx *= 1.8 / speed;
          d.vy *= 1.8 / speed;
        }
        if (d.x < -10) d.x = window.innerWidth + 10;
        if (d.x > window.innerWidth + 10) d.x = -10;
        if (d.y < -10) d.y = window.innerHeight + 10;
        if (d.y > window.innerHeight + 10) d.y = -10;
        const a = d.alpha * 0.7;
        const grad = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, d.r * 6);
        grad.addColorStop(0, `rgba(${d.cr},${d.cg},${d.cb},${a})`);
        grad.addColorStop(0.4, `rgba(${d.cr},${d.cg},${d.cb},${a * 0.3})`);
        grad.addColorStop(1, `rgba(${d.cr},${d.cg},${d.cb},0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r * 6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    tick();
  }

  return {
    palette: palette,
    softCircleTexture: softCircleTexture,
    ATTRACTORS: ATTRACTORS,
    genTrail: genTrail,
    createPointsMaterial: createPointsMaterial,
    initAmbientDrift: initAmbientDrift
  };

})();
