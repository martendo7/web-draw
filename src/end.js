/*
 * This file is part of Web Draw.
 *
 * Web Draw - A little real-time online collaborative drawing program.
 * Copyright (C) 2020-2021 martendo
 *
 * Web Draw is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * Web Draw is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with Web Draw.  If not, see <https://www.gnu.org/licenses/>.
 */

// Add various objects to msgpack codec
// ImageData
msgpack.codec.preset.addExtPacker(0x00, ImageData, (imageData) => {
  return msgpack.encode([
    imageData.data,
    imageData.width,
    imageData.height,
  ]).slice(1);
});
msgpack.codec.preset.addExtUnpacker(0x00, (buffer) => {
  const properties = msgpack.decode([0x93, ...new Uint8Array(buffer)]);
  return new ImageData(properties[0], properties[1], properties[2]);
});
[
  Pos2D,
  PastAction,
  Action,
  Stroke,
  Fill,
  Selection,
  SelectionResize,
  SelectionPaste,
  OldSelection,
  ShortSelection,
  Line,
  Shape,
  ShapeColours,
  RectWithColour,
].forEach((object, index) => {
  const type = 0x20 + index;
  msgpack.codec.preset.addExtPacker(type, object, (obj) => object.packer(obj));
  msgpack.codec.preset.addExtUnpacker(type, (buffer) => object.unpacker(buffer));
});

// List of ping latency measurements to calculate average
var prevPings = [];

// Drawing and tool variables
var penColours = Colour.DEFAULTS.slice();
var currentPen = 0;
var tool = "pen";

var clients = {};

// Whether mouse has moved or not since last update was sent to server
var mouseMoved = {
  moved: false,
  outside: false,
};
// Cache mousemove event so it may be used outside of a MouseEvent listener
var cachedMouseEvent = null;

// Most recent custom colours
var customColours = [];

// Tell the user if their browser does not support WebSockets
if (!("WebSocket" in window)) {
  Modal.open("noWsModal");
}

const waitConnect = () => {
  const wait = document.getElementById("connectionInfoWait");
  if (wait.textContent.length === 3) {
    wait.textContent = "";
  }
  wait.innerHTML += "&#183;";
};
const connectionWait = setInterval(() => waitConnect(), 500);
waitConnect();

Client.init();

Tools.loadToolSettings(tool);

// Set up events that end or cancel actions for all of the page in case it happens outside of the canvas
document.addEventListener("pointermove", (event) => mouseMove(event), { passive: false });
document.addEventListener("pointerup", (event) => clearMouseHold(event), { passive: false });
document.addEventListener("pointercancel", (event) => clearMouseHold(event), { passive: false });
document.addEventListener("pointerleave", (event) => clearMouseHold(event), { passive: false });
document.addEventListener("contextmenu", (event) => {
  const tagName = event.target.tagName;
  if (tagName === "A" || tagName === "INPUT" || tagName === "TEXTAREA") {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
});
document.addEventListener("click", (event) => {
  if (event.target.tagName === "LI") {
    return;
  }
  const selected = document.getElementsByClassName("menuSelected");
  for (var i = 0; i < selected.length; i++) {
    selected[i].classList.remove("menuSelected");
  }
});

window.addEventListener("resize", () => Canvas.updateCanvasAreaSize());

Canvas.displayCanvas.addEventListener("pointermove", (event) => {
  cachedMouseEvent = event;
});

document.addEventListener("keydown", (event) => {
  // Keyboard shortcuts that can only be used when not currently typing or on the canvas
  const tagName = event.target.tagName;
  
  notTyping:
  if (tagName !== "INPUT" && tagName !== "TEXTAREA" && !event.target.isContentEditable && Modal.index === 100) {
    if (!event.ctrlKey) {
      switch (event.key) {
        case "1": {
          Canvas.setZoom(1, true);
          break;
        }
        case "2": {
          Canvas.setZoom(2, true);
          break;
        }
        case "3": {
          Canvas.setZoom(4, true);
          break;
        }
        case "4": {
          Canvas.setZoom(8, true);
          break;
        }
        case "5": {
          Canvas.setZoom(16, true);
          break;
        }
        case "=": {
          Canvas.changeZoom(0.1);
          break;
        }
        case "-": {
          Canvas.changeZoom(-0.1);
          break;
        }
        default: break notTyping;
      }
      event.preventDefault();
      return;
    } else {
      switch (event.key) {
        case "z": {
          ActionHistory.moveWithOffset(-1);
          break;
        }
        case "Z":
        case "y": {
          ActionHistory.moveWithOffset(+1);
          break;
        }
        case "c": {
          if (tool !== "select") {
            break notTyping;
          }
          SelectTool.doCopy();
          break;
        }
        case "x": {
          if (tool !== "select") {
            break notTyping;
          };
          SelectTool.doCut();
          break;
        }
        case "v": {
          if (tool !== "select") {
            break notTyping;
          };
          SelectTool.doPaste();
          break;
        }
        default: break notTyping;
      }
      event.preventDefault();
      return;
    }
  }
  // Keyboard shortcuts that can be used anywhere
  if (!event.ctrlKey) {
    switch (event.key) {
      case "F1": {
        Modal.open("helpModal");
        break;
      }
      case "Escape": {
        Chat.toggle();
        break;
      }
      default: return;
    }
    event.preventDefault();
  }
});

// Set up events for the canvas, but not the move or ending ones (see above event listeners)
Canvas.displayCanvas.addEventListener("pointerdown", (event) => mouseHold(event));
Canvas.displayCanvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  if (!event.ctrlKey) {
    // Scroll
    const delta = Math.sign(event.deltaY) * 75;
    if (event.shiftKey) {
      Canvas.pan.x += delta;
    } else {
      Canvas.pan.y += delta;
    }
    Canvas.drawCanvas();
  } else {
    // Zoom
    const delta = Math.sign(event.deltaY) * -0.25;
    Canvas.changeZoom(delta);
  }
});

// Set up inputs
document.getElementById("createSessionBtn").addEventListener("click", () => Session.create());
document.getElementById("joinSessionBtn").addEventListener("click", () => Session.join());

const colourPicker = document.getElementById("colourPicker");
colourPicker.addEventListener("input", (event) => {
  Colour.update(currentPen, event.target.value);
});
colourPicker.addEventListener("change", (event) => {
  Colour.change(currentPen, event.target.value);
});

const quickColourSelect = document.getElementById("quickColourSelect");
quickColourSelect.addEventListener("click", (event) => { event.preventDefault(); });
quickColourSelect.addEventListener("contextmenu", (event) => { event.preventDefault(); });

document.getElementById("chooseImage").addEventListener("change", (event) => Canvas.importImage(event));
document.getElementById("chooseCanvasFile").addEventListener("change", (event) => Canvas.openFile(event));

const penColourBoxes = document.getElementsByClassName("penColour");
for (let i = 0; i < penColourBoxes.length; i++) {
  const penColourBox = penColourBoxes[i];
  penColourBox.addEventListener("click", () => {
    currentPen = i;
    Colour.openPicker(i);
  });
  penColourBox.addEventListener("contextmenu", () => {
    currentPen = i;
    Colour.openPicker(i);
  });
}
const penColourValues = document.getElementsByClassName("penColourValue");
for (let i = 0; i < penColourValues.length; i++) {
  penColourValues[i].addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      Colour.changeWithValue(i, event);
    }
  });
}
for (const toolName of Tools.NAMES) {
  document.getElementById(toolName + "Btn").addEventListener("click", () => switchTool(toolName));
}

const menuLabels = document.getElementsByClassName("menuLabel");
for (let i = 0; i < menuLabels.length; i++) {
  const menuLabel = menuLabels[i];
  if (menuLabel.parentElement.getElementsByClassName("menuDropdown").length > 0) {
    menuLabel.addEventListener("click", () => {
      const selected = document.getElementsByClassName("menuSelected");
      for (var i = 0; i < selected.length; i++) {
        if (selected[i] !== menuLabel.parentElement) {
          selected[i].classList.remove("menuSelected");
        }
      }
      menuLabel.parentElement.classList.toggle("menuSelected");
      event.stopPropagation();
    });
  }
}
document.getElementById("fileSaveBtn").addEventListener("click", () => Canvas.saveFile());
document.getElementById("fileOpenBtn").addEventListener("click", () => {
  const filePicker = document.getElementById("chooseCanvasFile");
  filePicker.click();
});
document.getElementById("fileExportBtn").addEventListener("click", () => Canvas.exportImage());
document.getElementById("fileImportBtn").addEventListener("click", () => {
  const filePicker = document.getElementById("chooseImage");
  filePicker.click();
});
document.getElementById("editUndoBtn").addEventListener("click", () => ActionHistory.moveWithOffset(-1));
document.getElementById("editRedoBtn").addEventListener("click", () => ActionHistory.moveWithOffset(+1));
document.getElementById("editClearBtn").addEventListener("click", () => Canvas.clearBlank());
document.getElementById("editClearTransparentBtn").addEventListener("click", () => Canvas.clear());
document.getElementById("editSettingsBtn").addEventListener("click", () => Modal.open("settingsModal"));
document.getElementById("viewResetZoomBtn").addEventListener("click", () => Canvas.setZoom(Canvas.DEFAULT_ZOOM));
document.getElementById("viewFitZoomBtn").addEventListener("click", () => Canvas.zoomToWindow("fit"));
document.getElementById("viewFillZoomBtn").addEventListener("click", () => Canvas.zoomToWindow("fill"));
document.getElementById("sessionInfoBtn").addEventListener("click", () => Modal.open("sessionInfoModal"));
document.getElementById("sessionChangeIdBtn").addEventListener("click", () => {
  document.getElementById("sessionIdNew").value = Session.id;
  Modal.open("changeSessionIdModal");
});
document.getElementById("sessionSetPasswordBtn").addEventListener("click", () => Modal.open("setSessionPasswordModal"));
document.getElementById("sessionShareLinkBtn").addEventListener("click", () => Modal.open("shareSessionLinkModal"));
document.getElementById("sessionLeaveBtn").addEventListener("click", () => Session.leave());
document.getElementById("helpHelpBtn").addEventListener("click", () => Modal.open("helpModal"));
document.getElementById("helpInfoBtn").addEventListener("click", () => Modal.open("infoModal"));
document.getElementById("helpBtn").addEventListener("click", () => Modal.open("helpModal"));
document.getElementById("infoBtn").addEventListener("click", () => Modal.open("infoModal"));
document.getElementById("userBtn").addEventListener("click", () => {
  document.getElementById("userNameInput").value = clients[Client.id].name || "";
  Modal.open("userModal");
});
document.getElementById("chatBtn").addEventListener("click", () => Chat.toggle());
document.getElementById("chatXBtn").addEventListener("click", () => Chat.close());

const tabs = [...document.getElementsByClassName("tab")];
tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    tabs.forEach((t) => {
      t.classList.remove("tabSelected");
      document.getElementById(t.id + "Box").style.display = "none";
    });
    tab.classList.add("tabSelected");
    document.getElementById(tab.id + "Box").style.display = "table";
  });
});
document.getElementById("toolTab").dispatchEvent(new Event("click"));

Chat.input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    Chat.send();
    event.preventDefault();
  }
});
Chat.input.addEventListener("input", () => {
  const box = document.getElementById("chatMessages");
  const isAtBottom = box.scrollTop === box.scrollHeight - box.clientHeight;
  elementFitHeight(Chat.input);
  if (isAtBottom) {
    box.scrollTop = box.scrollHeight - box.clientHeight;
  }
});
document.getElementById("chatSendBtn").addEventListener("click", () => Chat.send());

document.getElementById("undoBtn").addEventListener("click", () => ActionHistory.moveWithOffset(-1));
document.getElementById("redoBtn").addEventListener("click", () => ActionHistory.moveWithOffset(+1));
const clearBtn = document.getElementById("clearBtn");
clearBtn.addEventListener("click", () => Canvas.clearBlank());
clearBtn.addEventListener("dblclick", () => Canvas.clear());
document.getElementById("resetZoomBtn").addEventListener("click", () => Canvas.setZoom(Canvas.DEFAULT_ZOOM));
document.getElementById("fitZoomBtn").addEventListener("click", () => Canvas.zoomToWindow("fit"));

document.getElementById("shareLinkBtn").addEventListener("click", () => Modal.open("shareSessionLinkModal"));
document.getElementById("leaveBtn").addEventListener("click", () => Session.leave());

[...document.getElementsByClassName("clickToCopy")].forEach((el) => {
  el.addEventListener("click", (event) => copyText(el.textContent, event));
});
document.getElementById("allPingsLink").addEventListener("click", () => Modal.open("allPingsModal"));

document.getElementById("allPingsModalDoneBtn").addEventListener("click", () => Modal.close("allPingsModal"));

const resizeWidth = document.getElementById("canvasResizeWidth");
const resizeHeight = document.getElementById("canvasResizeHeight");
const offsetX = document.getElementById("canvasResizeOffsetX");
const offsetY = document.getElementById("canvasResizeOffsetY");
document.getElementById("editResizeBtn").addEventListener("click", () => {
  resizeWidth.value = Session.canvas.width;
  resizeHeight.value = Session.canvas.height;
  offsetX.min = 0;
  offsetX.max = 0;
  offsetX.value = 0;
  offsetY.min = 0;
  offsetY.max = 0;
  offsetY.value = 0;
  updateResizePreview();
  Modal.open("canvasResizeModal");
});
resizeWidth.addEventListener("input", () => {
  const delta = parseInt(resizeWidth.value, 10) - Session.canvas.width;
  offsetX.min = Math.min(delta, 0);
  offsetX.max = Math.max(delta, 0);
  offsetX.value = minmax(parseInt(offsetX.value, 10), offsetX.min, offsetX.max);
});
resizeHeight.addEventListener("input", () => {
  const delta = parseInt(resizeHeight.value, 10) - Session.canvas.height;
  offsetY.min = Math.min(delta, 0);
  offsetY.max = Math.max(delta, 0);
  offsetY.value = minmax(parseInt(offsetY.value, 10), offsetY.min, offsetY.max);
});
document.getElementById("canvasResizeOffsetCentre").addEventListener("click", () => {
  offsetX.value = Math.round((parseInt(resizeWidth.value, 10) - Session.canvas.width) / 2);
  offsetY.value = Math.round((parseInt(resizeHeight.value, 10) - Session.canvas.height) / 2);
  updateResizePreview();
});

const resizeFill = document.getElementById("canvasResizeFill");
resizeFill.value = 1;
function getResizeFillColour() {
  switch (parseInt(resizeFill.value, 10)) {
    case 0: {
      return penColours[0];
    }
    case 1: {
      return penColours[1];
    }
    case 2: {
      return "#ffffff";
    }
    // Transparency = null
    case 3:
    default: {
      return null;
    }
  }
}

const previewCanvas = document.getElementById("resizePreviewCanvas");
const previewCtx = previewCanvas.getContext("2d");
function updateResizePreview() {
  const newWidth = parseInt(resizeWidth.value, 10);
  const newHeight = parseInt(resizeHeight.value, 10);

  const canvasWidth = Session.canvas.width;
  const canvasHeight = Session.canvas.height;

  const previewWidth = Math.max(newWidth, newWidth + (canvasWidth - newWidth) * 2);
  const previewHeight = Math.max(newHeight, newHeight + (canvasHeight - newHeight) * 2);
  var divisor;
  if (previewWidth > previewHeight) {
    previewCanvas.width = 200;
    divisor = previewWidth / 200;
    previewCanvas.height = previewHeight / divisor;
  } else {
    previewCanvas.height = 200;
    divisor = previewHeight / 200;
    previewCanvas.width = previewWidth / divisor;
  }
  const previewNewWidth = Math.round(newWidth / divisor);
  const previewNewHeight = Math.round(newHeight / divisor);
  const previewX = Math.round((previewCanvas.width / 2) - (previewNewWidth / 2));
  const previewY = Math.round((previewCanvas.height / 2) - (previewNewHeight / 2));
  const previewCanvasX = Math.round(previewX + (parseInt(offsetX.value, 10) / divisor));
  const previewCanvasY = Math.round(previewY + (parseInt(offsetY.value, 10) / divisor));
  const previewCanvasWidth = Math.round(canvasWidth / divisor);
  const previewCanvasHeight = Math.round(canvasHeight / divisor);
  
  const bgColour = getResizeFillColour();
  if (bgColour) {
    previewCtx.fillStyle = bgColour;
  } else {
    previewCtx.fillStyle = Canvas._transparentPattern;
  }
  previewCtx.fillRect(previewX, previewY, previewNewWidth, previewNewHeight);
  
  previewCtx.fillStyle = Canvas._transparentPattern;
  previewCtx.fillRect(previewCanvasX, previewCanvasY, previewCanvasWidth, previewCanvasHeight);
  previewCtx.drawImage(Session.canvas, previewCanvasX, previewCanvasY, previewCanvasWidth, previewCanvasHeight);
  
  previewCtx.lineWidth = 1;
  previewCtx.strokeStyle = "#000000";
  previewCtx.globalAlpha = 0.5;
  previewCtx.strokeRect(previewX - 0.5, previewY - 0.5, previewNewWidth + 1, previewNewHeight + 1);
  previewCtx.globalAlpha = 0.25;
  previewCtx.strokeRect(previewCanvasX - 0.5, previewCanvasY - 0.5, previewCanvasWidth + 1, previewCanvasHeight + 1);
  previewCtx.globalAlpha = 1;
}

[resizeWidth, resizeHeight, offsetX, offsetY, resizeFill].forEach((input) => {
  input.addEventListener("input", () => updateResizePreview());
});

document.getElementById("resizeModalResetBtn").addEventListener("click", () => {
  resizeWidth.value = Session.canvas.width;
  resizeWidth.dispatchEvent(new Event("input"));
  resizeHeight.value = Session.canvas.height;
  resizeHeight.dispatchEvent(new Event("input"));
  resizeFill.value = 1;;
});
document.getElementById("resizeModalResizeBtn").addEventListener("click", () => {
  Modal.close("canvasResizeModal");
  const options = new RectWithColour({
    width: parseInt(resizeWidth.value, 10),
    height: parseInt(resizeHeight.value, 10),
    x: parseInt(offsetX.value, 10),
    y: parseInt(offsetY.value, 10),
    colour: getResizeFillColour(),
  });
  Client.sendMessage({
    type: Message.RESIZE_CANVAS,
    options: options,
  });
  Canvas.resize(options);
});
document.getElementById("resizeModalCancelBtn").addEventListener("click", () => Modal.close("canvasResizeModal"));

document.getElementById("settingsModalDoneBtn").addEventListener("click", () => Modal.close("settingsModal"));
document.getElementById("sendMouseMovements").addEventListener("input", (event) => Client.setSendMouse(event.target.checked));
document.getElementById("receiveMouseMovements").addEventListener("input", (event) => Client.setReceiveMouse(event.target.checked));

document.getElementById("lightTheme").addEventListener("change", () => setTheme("light"));
document.getElementById("darkTheme").addEventListener("change", () => setTheme("dark"));
const theme = localStorage.getItem("theme");
if (theme) {
  document.documentElement.className = theme;
  document.getElementById(theme + "Theme").checked = true;
}

document.getElementById("helpModalDoneBtn").addEventListener("click", () => {
  Modal.close("helpModal");
  location.hash = "";
});
document.getElementById("infoModalDoneBtn").addEventListener("click", () => Modal.close("infoModal"));

document.getElementById("sessionInfoModalDoneBtn").addEventListener("click", () => Modal.close("sessionInfoModal"));

document.getElementById("sessionIdModalChangeBtn").addEventListener("click", () => Session.changeId());
document.getElementById("sessionIdModalCancelBtn").addEventListener("click", () => Modal.close("changeSessionIdModal"));
document.getElementById("sessionIdChangedModalOkBtn").addEventListener("click", () => Modal.close("sessionIdChangedModal"));
document.getElementById("sessionHasIdModalOkBtn").addEventListener("click", () => Modal.close("sessionHasIdModal"));

document.getElementById("setSessionPasswordModalRemoveBtn").addEventListener("click", () => {
  Client.sendMessage({
    type: Message.SESSION_PASSWORD,
    password: null,
  });
});
document.getElementById("setSessionPasswordModalSetBtn").addEventListener("click", () => Session.setPassword());
document.getElementById("setSessionPasswordModalCancelBtn").addEventListener("click", () => Modal.close("setSessionPasswordModal"));

document.getElementById("shareLinkModalCloseBtn").addEventListener("click", () => Modal.close("shareSessionLinkModal"));
document.getElementById("sessionLinkCopy").addEventListener("click", (event) => copyText(Session.link));
document.getElementById("sessionLinkPasswordInput").addEventListener("input", () => Session.updateLink());

document.getElementById("enterSessionPasswordModalJoinBtn").addEventListener("click", () => Session.enterPassword());
document.getElementById("enterSessionPasswordModalCancelBtn").addEventListener("click", () => Modal.close("enterSessionPasswordModal"));
document.getElementById("sessionWrongPasswordModalOkBtn").addEventListener("click", () => Modal.close("sessionWrongPasswordModal"));

document.getElementById("appInfoLink").addEventListener("click", () => Modal.open("appInfoModal"));
document.getElementById("appInfoModalDoneBtn").addEventListener("click", () => Modal.close("appInfoModal"));

document.getElementById("errorModalOkBtn").addEventListener("click", () => Modal.close("errorModal"));
document.getElementById("oldCanvasFileModalOkBtn").addEventListener("click", () => Modal.close("oldCanvasFileModal"));
document.getElementById("disconnectModalGiveUpBtn").addEventListener("click", () => Client.disconnect());
document.getElementById("sessionNoExistModalOkBtn").addEventListener("click", () => Modal.close("sessionNoExistModal"));
document.getElementById("sessionAlreadyExistModalOkBtn").addEventListener("click", () => Modal.close("sessionAlreadyExistModal"));

document.getElementById("userModalSaveBtn").addEventListener("click", () => Session.saveUserSettings());
document.getElementById("userModalCancelBtn").addEventListener("click", () => Modal.close("userModal"));

document.getElementById("canvasZoom").addEventListener("input", (event) => Canvas.setZoomValue(event));

document.getElementById("selectCopyBtn").addEventListener("click", () => SelectTool.doCopy());
document.getElementById("selectCutBtn").addEventListener("click", () => SelectTool.doCut());
document.getElementById("selectPasteBtn").addEventListener("click", () => SelectTool.doPaste());
document.getElementById("selectClearBtn").addEventListener("click", () => {
  Client.sendMessage({
    type: Message.SELECTION_CLEAR,
    colour: penColours[1],
    clientId: Client.id,
  });
  SelectTool.clear(clients[Client.id].action.data, penColours[1]);
});

window.addEventListener("beforeunload", () => {
  Session.leave();
  Client.socket.close(1000);
});
