def elapsed_frames(page, seconds):
    page.evaluate("""seconds => new Promise(resolve => {
      let elapsed = 0, previous;
      function step(now) {
        if (previous !== undefined) elapsed += Math.min(0.041, (now - previous) / 1000);
        previous = now;
        if (elapsed >= seconds) resolve();
        else requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    })""", seconds)


def walk(page, key, seconds):
    page.keyboard.down(key)
    try:
        elapsed_frames(page, seconds)
    finally:
        page.keyboard.up(key)


def drag(page, dx, dy, start=(650, 440), button="left"):
    x, y = start
    page.mouse.move(x, y)
    page.mouse.down(button=button)
    page.mouse.move(x + dx, y + dy, steps=9)
    page.mouse.up(button=button)
