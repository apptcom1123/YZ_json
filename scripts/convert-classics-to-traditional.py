from pathlib import Path
import json
from opencc import OpenCC

ROOT = Path(__file__).resolve().parents[1]
converter = OpenCC('s2t')

def convert_value(value):
    if isinstance(value, dict):
        return {key: convert_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [convert_value(item) for item in value]
    if isinstance(value, str):
        return converter.convert(value)
    return value

for directory in (ROOT / 'classics', ROOT / 'dist' / 'data' / 'classics'):
    if not directory.exists():
        continue
    for path in directory.glob('*.json'):
        data = json.loads(path.read_text(encoding='utf-8'))
        path.write_text(json.dumps(convert_value(data), ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(path)

for path in ROOT.glob('*.md'):
    if path.name in {'Readme.md', 'ToDO.txt'}:
        continue
    text = path.read_text(encoding='utf-8')
    path.write_text(converter.convert(text), encoding='utf-8')
    print(path)
