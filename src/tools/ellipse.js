const Ellipse = {
  draw(ellipse, ctx, user = true) {
    const x = (ellipse.x + (ellipse.x + ellipse.width)) / 2;
    const y = (ellipse.y + (ellipse.y + ellipse.height)) / 2;
    const radiusX = Math.abs(x - ellipse.x);
    const radiusY = Math.abs(y - ellipse.y);
    
    ctx.globalAlpha = ellipse.opacity;
    ctx.globalCompositeOperation = user ? DEFAULT_COMP_OP : COMP_OPS[ellipse.compOp];
    
    if (ellipse.fill) {
      ctx.fillStyle = ellipse.colours.fill;
      ctx.beginPath();
      ctx.ellipse(x, y, radiusX, radiusY, 0, 0, 2 * Math.PI);
      ctx.fill();
    }
    if (ellipse.outline) {
      ctx.strokeStyle = ellipse.colours.outline;
      ctx.lineWidth = ellipse.lineWidth;
      ctx.beginPath();
      ctx.ellipse(x, y, radiusX, radiusY, 0, 0, 2 * Math.PI);
      ctx.stroke();
    }
    
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = DEFAULT_COMP_OP;
  }
};
