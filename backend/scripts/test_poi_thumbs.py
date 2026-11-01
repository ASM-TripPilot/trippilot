"""poi_thumbs 검사 — `python3 -m unittest scripts/test_poi_thumbs.py` (backend/ 에서). 리사이즈 검사는 Pillow 가 있을 때만 돈다."""

import io
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(__file__))
import poi_thumbs as t  # noqa: E402

try:
    from PIL import Image
except ImportError:
    Image = None


class KeyAndSql(unittest.TestCase):
    def test_키는_URL_해시라_같은_URL_이면_같고_다르면_다르다(self):
        self.assertEqual(t.thumb_key("https://a/1.jpg"), t.thumb_key("https://a/1.jpg"))
        self.assertNotEqual(t.thumb_key("https://a/1.jpg"), t.thumb_key("https://a/2.jpg"))
        self.assertRegex(t.thumb_key("https://a/1.jpg"), r"^poi/[0-9a-f]{20}\.webp$")

    def test_SQL_은_따옴표를_이스케이프하고_원본이_같은_행만_고친다(self):
        sql = t.update_sql("https://a/it's.jpg", "https://cdn.example.net/")
        self.assertIn("'https://a/it''s.jpg'", sql)
        self.assertIn("WHERE image_url = 'https://a/it''s.jpg'", sql)
        self.assertIn(f"'https://cdn.example.net/{t.thumb_key('https://a/it' + chr(39) + 's.jpg')}'", sql)  # 끝 슬래시 정리

    def test_https_가_아니면_받지_않는다(self):
        with self.assertRaises(ValueError):
            t.download("http://a/1.jpg")
        with self.assertRaises(ValueError):
            t.download("file:///etc/passwd")


@unittest.skipUnless(Image, "Pillow 없음")
class Resize(unittest.TestCase):
    def jpeg(self, w, h):
        buf = io.BytesIO()
        Image.new("RGB", (w, h), (200, 30, 30)).save(buf, "JPEG", quality=95)
        return buf.getvalue()

    def test_940px_는_560px_WebP_로_줄고_비율을_지킨다(self):
        src = self.jpeg(940, 705)
        out = t.resize(src)
        img = Image.open(io.BytesIO(out))
        self.assertEqual((img.format, img.width, img.height), ("WEBP", 560, 420))
        self.assertLess(len(out), len(src))

    def test_작은_원본은_키우지_않는다(self):
        self.assertEqual(Image.open(io.BytesIO(t.resize(self.jpeg(300, 200)))).width, 300)

    def test_실패한_URL_은_SQL_에_넣지_않고_성공분만_쓴다(self):
        with tempfile.TemporaryDirectory() as d:
            urls, sql, out = f"{d}/u.txt", f"{d}/o.sql", f"{d}/out"
            open(urls, "w").write("http://insecure/x.jpg\n")          # https 아님 → 실패
            rc = t.main([urls, "--cdn", "https://c.example", "--sql", sql, "--out-dir", out])
            self.assertEqual(rc, 1)                                   # 성공 0건이면 실패 코드
            self.assertNotIn("UPDATE", open(sql).read())


if __name__ == "__main__":
    unittest.main()
