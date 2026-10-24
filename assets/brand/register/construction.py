"""Chosen register mark: three consistent sheet planes in the same projection."""

from pathlib import Path
import json
import math
import xml.etree.ElementTree as ET

ROOT=Path(__file__).resolve().parent
RECEDING_SLOPE=.4
RETURN_SLOPE=.45
LEFT, FOLD, BACK, RIGHT=10,26,70,86
TOP=8
PARALLEL_GAP=8.8
MASTER_SLIT=5.5
INK_WIDTH=190/3  # Preserve the existing horizontal footprint.
LOCKUP_MARK_HEIGHT=78
WORDMARK_X=108
WORDMARK_HEIGHT=58
LOCKUP_WIDTH=469
DEPTH=RIGHT-BACK
PLANE_THICKNESS=DEPTH*(RECEDING_SLOPE+RETURN_SLOPE)
TOP_UPPER=TOP+RECEDING_SLOPE*BACK
TOP_LOWER=TOP_UPPER+PLANE_THICKNESS
MIDDLE_UPPER=TOP_LOWER+PARALLEL_GAP
MIDDLE_LOWER=MIDDLE_UPPER+PLANE_THICKNESS
LOWER_UPPER=MIDDLE_LOWER+PARALLEL_GAP
BASE_INTERCEPT=LOWER_UPPER+PLANE_THICKNESS
FOLD_BOTTOM=BASE_INTERCEPT-RECEDING_SLOPE*FOLD
SCALE=INK_WIDTH/(RIGHT-LEFT)
CENTER_Y=(TOP+FOLD_BOTTOM)/2
SMALL_SLIT=6/SCALE


def n(value):
    return f'{value:.9f}'.rstrip('0').rstrip('.')


TRANSFORM=f'translate(48 48) scale({n(SCALE)}) translate(-48 -{n(CENTER_Y)})'
LOCKUP_TRANSFORM=f'translate(48 48) scale({n(LOCKUP_MARK_HEIGHT/(FOLD_BOTTOM-TOP))}) translate(-48 -{n(CENTER_Y)})'
SPINE=[
    (BACK,TOP),(RIGHT,TOP+RETURN_SLOPE*DEPTH),
    (FOLD,TOP_LOWER-RECEDING_SLOPE*FOLD),(FOLD,FOLD_BOTTOM),
    (LEFT,FOLD_BOTTOM-RETURN_SLOPE*(FOLD-LEFT)),
    (LEFT,TOP+RECEDING_SLOPE*(BACK-LEFT)),
]


def polygon(points):
    return 'M'+'L'.join(f'{n(x)} {n(y)}' for x,y in points)+'Z'


def entry(upper, left):
    lower=upper+PLANE_THICKNESS
    return [(left,upper-RECEDING_SLOPE*left),
            (BACK,upper-RECEDING_SLOPE*BACK),
            (RIGHT,lower-RECEDING_SLOPE*RIGHT),
            (left,lower-RECEDING_SLOPE*left)]


def planes(small=False):
    left=FOLD+(SMALL_SLIT if small else MASTER_SLIT)
    return [SPINE,entry(MIDDLE_UPPER,left),entry(LOWER_UPPER,left)]


def paths(ink,small=False,transform=TRANSFORM):
    names=['spine-and-fold','middle-entry','lower-entry']
    shapes='\n    '.join(f'<path id="{name}" d="{polygon(points)}"/>' for name,points in zip(names,planes(small)))
    return f'<g fill="{ink}" transform="{transform}">\n    {shapes}\n  </g>'


def svg(ink,small=False,favicon=False):
    bg='  <rect width="96" height="96" rx="18" fill="#000"/>\n' if favicon else ''
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" role="img" aria-labelledby="title description">
  <title id="title">mietkartei — Registerfaltung</title>
  <desc id="description">Drei geordnete Eintragsebenen werden von einer gemeinsamen Falte gehalten. Die zurücklaufenden Kanten geben dem Zeichen eine klare räumliche Drehung.</desc>
{bg}  {paths(ink,small)}
</svg>
'''


def lockup(ink,adaptive=False):
    # adaptive: black ink that turns white when the viewer prefers a dark scheme, for places
    # like the GitHub app that ignore <picture> sources.
    style='<style>g{fill:#000}@media (prefers-color-scheme:dark){g{fill:#fff}}</style>\n  ' if adaptive else ''
    wordmark=ET.parse(ROOT.parent/'logo.svg').getroot()
    for element in wordmark.iter():
        element.tag=element.tag.rsplit('}',1)[-1]
    content=''.join(ET.tostring(e,encoding='unicode') for e in wordmark if e.tag in ('path','g'))
    svg=f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {LOCKUP_WIDTH} 96" role="img" aria-label="mietkartei mit Registerfaltung">
  {style}{paths(ink,transform=LOCKUP_TRANSFORM)}
  <g transform="translate({WORDMARK_X} 19) scale({n(WORDMARK_HEIGHT/774.8)})" fill="{ink}">{content}</g>
</svg>
'''
    return svg.replace(f' fill="{ink}"','') if adaptive else svg


HIGHLIGHT='#F5FF00'
HIGHLIGHT_GAP=4
HIGHLIGHT_PADDING=12


def lockup_highlight(ink):
    # Geist Semibold with a neon block behind "kartei". The block is exactly as tall as the mark,
    # so both share their top and bottom edge; "kartei" stays black on it in both schemes.
    outlines=json.loads((ROOT.parent/'variants'/'geist-semibold-outlines.json').read_text())
    miet,kartei=outlines['miet'],outlines['kartei']
    scale=WORDMARK_HEIGHT/774.8
    baseline=19+738.8*scale
    miet_x=WORDMARK_X+24*scale-miet['bounds'][0]*scale
    block_left=miet_x+miet['bounds'][2]*scale+HIGHLIGHT_GAP
    kartei_x=block_left+HIGHLIGHT_PADDING-kartei['bounds'][0]*scale
    block_right=kartei_x+kartei['bounds'][2]*scale+HIGHLIGHT_PADDING
    top=48-LOCKUP_MARK_HEIGHT/2
    def word(part,x,fill):
        return f'<path fill="{fill}" transform="translate({n(x)} {n(baseline)}) scale({n(scale)} -{n(scale)})" d="{part['d']}"/>'
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {math.ceil(block_right)} 96" role="img" aria-label="mietkartei mit Registerfaltung">
  {paths(ink,transform=LOCKUP_TRANSFORM)}
  <rect x="{n(block_left)}" y="{n(top)}" width="{n(block_right-block_left)}" height="{n(LOCKUP_MARK_HEIGHT)}" fill="{HIGHLIGHT}"/>
  {word(miet,miet_x,ink)}
  {word(kartei,kartei_x,'#000')}
</svg>
'''


def clean(value):
    if isinstance(value,float):return round(value,6)
    if isinstance(value,(list,tuple)):return [clean(item) for item in value]
    if isinstance(value,dict):return {key:clean(item) for key,item in value.items()}
    return value


if __name__=='__main__':
    for ink,suffix in (('#000',''),('#fff','-white')):
        (ROOT/f'mark{suffix}.svg').write_text(svg(ink))
        (ROOT/f'lockup{suffix}.svg').write_text(lockup(ink))
        (ROOT/f'lockup-highlight{suffix}.svg').write_text(lockup_highlight(ink))
    (ROOT/'lockup-auto.svg').write_text(lockup('#000',adaptive=True))
    (ROOT/'small.svg').write_text(svg('#000',small=True))
    (ROOT/'favicon.svg').write_text(svg('#fff',small=True,favicon=True))
    (ROOT/'geometry.json').write_text(json.dumps(clean({
        'status':'chosen register direction',
        'axes':{'receding':[1,-RECEDING_SLOPE],'return':[1,RETURN_SLOPE]},
        'return_angle_degrees':math.degrees(math.atan(RETURN_SLOPE)),
        'planes':planes(),'small_planes':planes(True),
        'parallel_gap_vertical':PARALLEL_GAP,'spine_gap':MASTER_SLIT,
        'small_spine_gap':SMALL_SLIT,'small_slit_at_16px':SMALL_SLIT*SCALE/96*16,
        'lower_return_height':0,'entry_thickness_vertical':PLANE_THICKNESS,
        'normalized_ink_width':INK_WIDTH,
        'wordmark':{'x':WORDMARK_X,'height':WORDMARK_HEIGHT,'viewBoxWidth':LOCKUP_WIDTH},
        'lockup':{'mark_height':LOCKUP_MARK_HEIGHT,'normalization':LOCKUP_TRANSFORM,
                  'gap':WORDMARK_X-48-LOCKUP_MARK_HEIGHT/2},
        'normalization':TRANSFORM,'viewBox':[0,0,96,96],
    }),indent=2)+'\n')
    for filename in ('mark.svg','mark-white.svg','favicon.svg','lockup.svg','lockup-white.svg','lockup-auto.svg',
                     'lockup-highlight.svg','lockup-highlight-white.svg'):
        (ROOT.parent/filename).write_bytes((ROOT/filename).read_bytes())
    print('Chosen register SVG masters, lockups, favicon and shared exports written.')
