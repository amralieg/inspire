import importlib

PDF_TOLERANCE = 0.5
PPTX_TOLERANCE = 0.02
PDF_PANEL_CLASSES = frozenset({"card", "uc", "it", "ribbon", "stack", "track", "glass", "untr"})
PDF_PANEL_CELL_TABLES = frozenset({"stats", "road", "glass"})
EMU_PER_INCH = 914400.0


def real_weasyprint():
    import sys
    cached = sys.modules.pop("weasyprint", None)
    try:
        return importlib.import_module("weasyprint")
    finally:
        if cached is not None and not hasattr(cached, "__file__"):
            sys.modules["weasyprint"] = cached


_WEASYPRINT = None


def _weasyprint():
    global _WEASYPRINT
    if _WEASYPRINT is None:
        _WEASYPRINT = real_weasyprint()
    return _WEASYPRINT


def _classes(box):
    element = getattr(box, "element", None)
    if element is None or getattr(box, "element_tag", None) is None:
        return set()
    return set(str(element.get("class") or "").split())


def _is_panel(box, parent_classes):
    if getattr(box, "is_for_root_element", False) or not hasattr(box, "border_box_x"):
        return False
    if getattr(box, "element_tag", "") == "td" and parent_classes & PDF_PANEL_CELL_TABLES:
        return True
    return bool(_classes(box) & PDF_PANEL_CLASSES)


def _rect(box):
    if hasattr(box, "border_box_x"):
        return box.border_box_x(), box.border_box_y(), box.border_width(), box.border_height()
    return box.position_x, box.position_y, getattr(box, "width", 0) or 0, getattr(box, "height", 0) or 0


def _label(box):
    classes = " ".join(sorted(_classes(box)))
    return f"{getattr(box, 'element_tag', type(box).__name__)}.{classes}" if classes else str(getattr(box, "element_tag", type(box).__name__))


def _walk(box, table_classes, panels, page_no, violations, content):
    children = list(getattr(box, "children", []) or [])
    for child in children:
        own_table = table_classes
        if getattr(child, "element_tag", "") == "table":
            own_table = _classes(child)
        x, y, w, h = _rect(child)
        if w > 0 and h > 0 and getattr(child, "style", None) is not None and child.style["visibility"] != "hidden":
            for panel_label, (px, py, pw, ph) in panels:
                if (x < px - PDF_TOLERANCE or x + w > px + pw + PDF_TOLERANCE
                        or y < py - PDF_TOLERANCE or y + h > py + ph + PDF_TOLERANCE):
                    violations.append(f"page {page_no}: {_label(child)} x={x:.1f}..{x + w:.1f} y={y:.1f}..{y + h:.1f} outside "
                                      f"{panel_label} x={px:.1f}..{px + pw:.1f} y={py:.1f}..{py + ph:.1f}")
                    break
        next_panels = panels
        if _is_panel(child, table_classes):
            cx, cy, cw, ch = _rect(child)
            left, right, top, bottom = content
            if (cx < left - PDF_TOLERANCE or cx + cw > right + PDF_TOLERANCE
                    or cy < top - PDF_TOLERANCE or cy + ch > bottom + PDF_TOLERANCE):
                violations.append(f"page {page_no}: panel {_label(child)} x={cx:.1f}..{cx + cw:.1f} y={cy:.1f}..{cy + ch:.1f} outside "
                                  f"the page content area x={left:.1f}..{right:.1f} y={top:.1f}..{bottom:.1f}")
            next_panels = panels + [(_label(child), (cx, cy, cw, ch))]
        _walk(child, own_table, next_panels, page_no, violations, content)


def pdf_layout(html: str):
    import sys
    real = _weasyprint()
    previous = sys.modules.get("weasyprint")
    sys.modules["weasyprint"] = real
    try:
        return real.HTML(string=html).render()
    finally:
        if previous is None:
            sys.modules.pop("weasyprint", None)
        else:
            sys.modules["weasyprint"] = previous


def pdf_geometry_violations(document) -> list:
    violations = []
    for page_no, page in enumerate(document.pages, start=1):
        page_box = page._page_box
        left, top = page_box.content_box_x(), page_box.content_box_y()
        content = (left, left + page_box.width, top, top + page_box.height)
        _walk(page_box, set(), [], page_no, violations, content)
    return violations


def _collect_segments(box, class_name, seen, out, current):
    for child in list(getattr(box, "children", []) or []):
        element = getattr(child, "element", None)
        if current is None and class_name in _classes(child) and id(element) not in seen:
            seen.add(id(element))
            entry = (_rect(child), [], set())
            out.append(entry)
            _collect_segments(child, class_name, seen, out, entry)
            continue
        if current is not None and getattr(child, "element_tag", "") == "span" and hasattr(child, "border_box_x") \
                and id(element) not in current[2]:
            current[2].add(id(element))
            current[1].append(_rect(child))
        _collect_segments(child, class_name, seen, out, current)


def pdf_segments(document, class_name="stack") -> list:
    out = []
    for page in document.pages:
        _collect_segments(page._page_box, class_name, set(), out, None)
    return [(rect, segments) for rect, segments, _seen in out]


def _inches(value):
    return (value or 0) / EMU_PER_INCH


def _shape_rect(shape):
    return _inches(shape.left), _inches(shape.top), _inches(shape.width), _inches(shape.height)


def _is_pptx_panel(shape):
    from pptx.enum.shapes import MSO_SHAPE_TYPE
    if shape.shape_type != MSO_SHAPE_TYPE.AUTO_SHAPE or shape.has_text_frame and shape.text_frame.text.strip():
        return False
    try:
        if shape.auto_shape_type is None or "OVAL" in str(shape.auto_shape_type):
            return False
        filled = shape.fill.type is not None
    except (NotImplementedError, ValueError):
        return False
    _x, _y, w, h = _shape_rect(shape)
    return filled and w >= 0.6 and h >= 0.3


def pptx_geometry_violations(prs) -> list:
    width, height = _inches(prs.slide_width), _inches(prs.slide_height)
    violations = []
    for slide_no, slide in enumerate(prs.slides, start=1):
        shapes = list(slide.shapes)
        panels = [s for s in shapes if _is_pptx_panel(s)]
        for shape in shapes:
            x, y, w, h = _shape_rect(shape)
            name = f"slide {slide_no}: {shape.name}"
            if x < -PPTX_TOLERANCE or y < -PPTX_TOLERANCE or x + w > width + PPTX_TOLERANCE or y + h > height + PPTX_TOLERANCE:
                violations.append(f"{name} ({x:.2f},{y:.2f},{w:.2f}x{h:.2f}) outside the slide {width:.2f}x{height:.2f}")
                continue
            cx, cy = x + w / 2.0, y + h / 2.0
            owners = []
            for panel in panels:
                if panel is shape:
                    continue
                px, py, pw, ph = _shape_rect(panel)
                if px <= cx <= px + pw and py <= cy <= py + ph and pw * ph > w * h:
                    owners.append((pw * ph, panel))
            if not owners:
                continue
            _area, owner = min(owners, key=lambda item: item[0])
            px, py, pw, ph = _shape_rect(owner)
            if x < px - PPTX_TOLERANCE or y < py - PPTX_TOLERANCE or x + w > px + pw + PPTX_TOLERANCE or y + h > py + ph + PPTX_TOLERANCE:
                violations.append(f"{name} ({x:.2f},{y:.2f},{w:.2f}x{h:.2f}) outside its panel {owner.name} ({px:.2f},{py:.2f},{pw:.2f}x{ph:.2f})")
    return violations
