# -*- coding: utf-8 -*-
"""Regression checks for directory opening and local-only startup."""

from pathlib import Path
import runpy
import sys
import unittest
from unittest.mock import patch

sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import app as font_app


class OpenDirectorySecurityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.folder = Path(__file__).parent / 'fixtures' / '字体 路径𠀀&测试'
        cls.folder.mkdir(parents=True, exist_ok=True)

    def setUp(self):
        self.client = font_app.app.test_client()
        self.popen = patch('subprocess.Popen').start()
        patch('time.sleep').start()
        patch('ctypes.windll.user32.keybd_event', create=True).start()
        self.addCleanup(patch.stopall)

    def test_existing_unicode_folder_is_one_argument_without_shell(self):
        response = self.client.post('/api/open_dir', json={'path': str(self.folder)})
        self.assertTrue(response.get_json()['success'])
        args, kwargs = self.popen.call_args
        self.assertIsInstance(args[0], list)
        self.assertEqual(args[0][1:], [str(self.folder.resolve())])
        self.assertFalse(kwargs.get('shell', False))

    def test_file_opens_its_parent_folder_instead_of_running_the_file(self):
        response = self.client.post('/api/open_dir', json={'path': __file__})
        self.assertTrue(response.get_json()['success'])
        args, kwargs = self.popen.call_args
        self.assertIsInstance(args[0], list)
        self.assertEqual(args[0][1:], [str(Path(__file__).resolve().parent)])
        self.assertFalse(kwargs.get('shell', False))

    def test_quote_breakout_is_rejected_before_process_creation(self):
        path = str(self.folder) + '" & echo FONT_AUDIT_MARKER & rem "'
        response = self.client.post('/api/open_dir', json={'path': path})
        self.assertFalse(response.get_json()['success'])
        self.popen.assert_not_called()

    def test_nonexistent_path_is_rejected_before_process_creation(self):
        response = self.client.post('/api/open_dir', json={
            'path': str(self.folder / 'does_not_exist'),
        })
        self.assertFalse(response.get_json()['success'])
        self.popen.assert_not_called()

    def test_invalid_path_types_and_control_characters_do_not_launch(self):
        for value in ['', '   ', None, 42, [], {}, 'bad\x00path', 'bad\npath']:
            with self.subTest(value=value):
                self.popen.reset_mock()
                response = self.client.post('/api/open_dir', json={'path': value})
                self.assertIsNotNone(response.get_json())
                self.assertFalse(response.get_json()['success'])
                self.popen.assert_not_called()

    def test_invalid_json_shape_has_json_error_without_process_creation(self):
        for raw_json in ['[]', 'null', '123', '{"path":']:
            with self.subTest(raw_json=raw_json):
                self.popen.reset_mock()
                response = self.client.post('/api/open_dir', data=raw_json,
                                            content_type='application/json')
                self.assertIsNotNone(response.get_json())
                self.assertFalse(response.get_json()['success'])
                self.popen.assert_not_called()

    def test_process_launch_error_is_reported_as_failure(self):
        self.popen.side_effect = OSError('launch failed')
        response = self.client.post('/api/open_dir', json={'path': str(self.folder)})
        self.assertFalse(response.get_json()['success'])


class LocalStartupSecurityTests(unittest.TestCase):
    def test_normal_startup_binds_only_loopback_without_debug(self):
        with patch('flask.Flask.run') as run:
            runpy.run_path(str(Path(font_app.__file__)), run_name='__main__')
        self.assertEqual(run.call_args.kwargs['host'], '127.0.0.1')
        self.assertFalse(run.call_args.kwargs['debug'])

    def test_ocr_page_displays_the_trusted_interpreter_as_readonly(self):
        from html.parser import HTMLParser

        class InputParser(HTMLParser):
            def __init__(self):
                super().__init__()
                self.attributes = None

            def handle_starttag(self, tag, attrs):
                values = dict(attrs)
                if tag == 'input' and values.get('id') == 'ocrPython':
                    self.attributes = values

        with patch.object(font_app, 'OCR_PYTHON', 'C:\\可信OCR环境\\python.exe', create=True):
            response = font_app.app.test_client().get('/ocr')
        parser = InputParser()
        parser.feed(response.get_data(as_text=True))
        self.assertEqual(parser.attributes['value'], 'C:\\可信OCR环境\\python.exe')
        self.assertIn('readonly', parser.attributes)
        self.assertNotIn('data-persist', parser.attributes)


if __name__ == '__main__':
    unittest.main()
