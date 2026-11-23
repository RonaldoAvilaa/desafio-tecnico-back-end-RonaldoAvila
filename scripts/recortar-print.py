"""Copia um print salvo e recorta a barra de tarefas (48 px de baixo).
Uso: py -3.12 scripts/recortar-print.py <origem.jpg|png> <nome_destino>
Salva em evidencias/<nome_destino>.jpg"""
import sys, os
from PIL import Image
origem, nome = sys.argv[1], sys.argv[2]
im = Image.open(origem).convert('RGB')
if im.size != (1366, 768):
    im = im.resize((1366, 768), Image.LANCZOS)
im = im.crop((0, 0, 1366, 768 - 48))
destino = os.path.join(os.path.dirname(__file__), '..', 'evidencias', nome + '.jpg')
im.save(destino, quality=92)
print('salvo', nome + '.jpg', im.size)
