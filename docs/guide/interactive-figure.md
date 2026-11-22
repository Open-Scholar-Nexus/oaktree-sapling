(guide-interactive-figure)=
# Interactive figures

A figure can be rendered as an interactive chart on the paper's website and as a static image in its PDF. Any plotting library works, if it can save a chart both as an image and as HTML. This guide uses [Altair](https://altair-viz.github.io). Altair describes a chart and its data in a format called Vega-Lite, which the website draws in the browser, and the package `vl-convert-python` draws the image from that same description without a browser, so the image in the PDF matches the chart on the website.

The chart is made in a Jupyter notebook, in one cell that saves it in both forms. The build reads what the notebook has saved, and shows the chart on the website and the image in the PDF.

## 1. Install the packages

```bash
pip install altair vl-convert-python
```

Altair makes the chart, and `vl-convert-python` turns it into an image.

## 2. Write the cell

Create `figure.ipynb` in the paper's folder, beside `index.md`, with one code cell:

```python
#| label: fig-growth
import altair as alt, vl_convert as vlc
from IPython.display import display

rows = [{"day": d, "height": h} for d, h in [(0, 1.2), (7, 3.4), (14, 6.1), (21, 7.9)]]
chart = (
    alt.Chart(alt.Data(values=rows))
    .mark_line(point=True)
    .encode(x="day:Q", y="height:Q", tooltip=["day:Q", "height:Q"])
)

display(
    {
        "text/html": chart._repr_mimebundle_(None, None)["text/html"],
        "image/svg+xml": vlc.vegalite_to_svg(chart.to_json()),
    },
    raw=True,
)
```

`display(..., raw=True)` saves the two outputs as the cell gives them. `text/html` is the interactive chart, for the website. `image/svg+xml` is the image the PDF shows.

`#| label: fig-growth` names the cell, and the paper embeds the figure by that name.

Give the cell the tag `remove-input`, which hides its code where the website shows the notebook.

If the PDF needs a PNG, replace the `image/svg+xml` line with `"image/png": vlc.vegalite_to_png(chart.to_json(), ppi=300)`.

Altair puts a `…` menu at the corner of the chart, to save the figure as SVG or PNG, and to see the chart's definition and data or open them in the Vega Editor.

## 3. Run the cell and save the notebook

When you [build your paper](#build) with `oak build`, your `figure.ipynb` notebook isn't run, so its outputs must be saved: run the cell, save the notebook, and commit it with its output. After a change to the chart or its data, run the cell and save again.

## 4. List the notebook in `myst.yml`

When `myst.yml` has a `toc`, the paper can embed a figure only from a file the `toc` lists. In the paper's `myst.yml`, add a `toc` under `project`:

```yaml
project:
  toc:
    - file: index.md
    - file: figure.ipynb
      hidden: true
```

`hidden: true` keeps the notebook out of the links between the website's pages. The notebook still has a page of its own, at `/figure`, and the figure links to it as its source.

With a `toc` without `figure.ipynb`, the figure will be empty on the website and in the PDF (the build still passes).

## 5. Embed the figure

In `index.md`, where the figure goes:

```markdown
:::{figure} #fig-growth
:label: fig-growth-curve
Seedling height over three weeks.
:::
```

`#fig-growth` is the cell's label. The text inside the directive is the caption. `:label:` is the name the text refers to the figure by, as in `[](#fig-growth-curve)`.

## 6. Check the result

1. Run `oak start`, open the address it prints, and hover over a point of the chart. A tooltip shows the point's values. The chart loads its drawing code from `cdn.jsdelivr.net`, so the browser has to be online.
2. Run `oak build` and open `_build/exports/paper.pdf`. The figure is in it as an image, with its caption.

## The thumbnail

To use the chart as the paper's thumbnail, save it as a PNG from the notebook, then commit the file:

```python
with open("thumbnails/thumbnail.png", "wb") as f:
    f.write(vlc.vegalite_to_png(chart.to_json(), ppi=300))
```

## `:placeholder:`

The `figure` directive has a `:placeholder:` option that names an image. With it set, the website shows that image in place of the chart. The PDF already takes its image from the cell's SVG output, so leave `:placeholder:` unset.
