# -*- coding: utf-8 -*-
"""OCR request validation and generated-worker security regressions."""

import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch


PROJECT_ROOT = Path(__file__).resolve().parents[1]
TRUSTED_PYTHON = str(PROJECT_ROOT / 'trusted_ocr' / 'python.exe')

# Loading the manager must not read deployment environment files during tests.
test_config = types.ModuleType('config')
test_config.OCR_PYTHON = TRUSTED_PYTHON
spec = importlib.util.spec_from_file_location(
    'ocr_security_manager', PROJECT_ROOT / 'utils' / 'ocr_manager.py')
ocr_module = importlib.util.module_from_spec(spec)
with patch.dict(sys.modules, {'config': test_config}):
    spec.loader.exec_module(ocr_module)


class OCRSecurityTests(unittest.TestCase):
    def test_non_object_requests_fail_before_starting_a_worker(self):
        for params in (None, [], 'ch', 42, False):
            with self.subTest(params=params):
                manager = ocr_module.OCRManager()
                with patch.object(ocr_module.threading, 'Thread') as thread:
                    try:
                        result = manager.start_ocr(params)
                    except Exception as exc:
                        self.fail(f'Invalid requests must return failure: {exc}')
                    self.assertFalse(result['success'])
                    self.assertEqual(manager.status, 'idle')
                    thread.assert_not_called()

    def test_unknown_or_non_string_models_fail_before_starting_a_worker(self):
        # This value is passive test data and is never executed.
        injection = "ch'); __import__('os').system('OCR_PAYLOAD'); #"
        for model in ('unsupported', injection, '', None, 7, [], {}):
            with self.subTest(model=model):
                manager = ocr_module.OCRManager()
                with patch.object(ocr_module.threading, 'Thread') as thread:
                    result = manager.start_ocr({'ocr_model': model})
                    self.assertFalse(result['success'])
                    self.assertEqual(manager.status, 'idle')
                    thread.assert_not_called()

    def test_every_ui_model_can_start(self):
        for model in ('ch', 'ch_server', 'handwriting', 'chinese_cht',
                      'en', 'japan', 'korean'):
            with self.subTest(model=model):
                manager = ocr_module.OCRManager()
                with patch.object(ocr_module.threading, 'Thread') as thread:
                    result = manager.start_ocr({'ocr_model': model})
                    self.assertTrue(result['success'])
                    thread.return_value.start.assert_called_once_with()

    def test_interpreter_overrides_fail_before_starting_a_worker(self):
        for value in (str(PROJECT_ROOT / 'untrusted.exe'), '', None, [], 7):
            with self.subTest(value=value):
                manager = ocr_module.OCRManager()
                with patch.object(ocr_module.threading, 'Thread') as thread, \
                        patch.object(ocr_module.subprocess, 'run') as process:
                    result = manager.start_ocr({'ocr_python': value})
                    self.assertFalse(result['success'])
                    self.assertEqual(manager.status, 'idle')
                    thread.assert_not_called()
                    process.assert_not_called()

    def test_legacy_matching_normalized_interpreter_is_accepted(self):
        equivalent = os.path.join(os.path.dirname(TRUSTED_PYTHON),
                                  '.', 'python.exe')
        with patch.object(ocr_module.threading, 'Thread') as thread:
            result = ocr_module.OCRManager().start_ocr(
                {'ocr_python': equivalent})
            self.assertTrue(result['success'])
            thread.return_value.start.assert_called_once_with()

    def test_worker_uses_only_configured_interpreter(self):
        calls = []

        def run_worker(args, **kwargs):
            calls.append(args)
            return types.SimpleNamespace(
                stdout='===RESULTS===\n[]', stderr='', returncode=0)

        manager = ocr_module.OCRManager()
        with patch.object(ocr_module.os.path, 'isdir', return_value=True), \
                patch('glob.glob', return_value=['C:/字图/uni20000_𠀀.png']), \
                patch.object(ocr_module.subprocess, 'run', run_worker):
            manager._run_ocr({
                'input_dir': 'C:/字图',
                'ocr_python': str(PROJECT_ROOT / 'untrusted.exe'),
            })
        self.assertEqual(manager.status, 'completed')
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][0], TRUSTED_PYTHON)

    def test_invalid_batch_model_is_rejected_before_creating_files(self):
        with patch.object(ocr_module.tempfile, 'NamedTemporaryFile',
                          wraps=ocr_module.tempfile.NamedTemporaryFile) as temporary, \
                patch.object(ocr_module.subprocess, 'run', return_value=
                             types.SimpleNamespace(stdout='===RESULTS===\n[]',
                                                   stderr='', returncode=0)) as process:
            with self.assertRaises(ValueError):
                ocr_module.OCRManager()._ocr_batch([], 'unsupported')
            temporary.assert_not_called()
            process.assert_not_called()

    def test_models_and_image_paths_are_data_in_a_fixed_worker_script(self):
        captures = []
        paths = ['C:/字图/uni20000_𠀀.png', "C:/字图/quote'\\line\n图.png"]

        def capture_worker(args, **kwargs):
            captures.append((
                Path(args[1]).read_text(encoding='utf-8'),
                json.loads(Path(args[2]).read_text(encoding='utf-8')),
                kwargs,
            ))
            return types.SimpleNamespace(
                stdout='===RESULTS===\n[]', stderr='', returncode=0)

        language_cases = (
            ('ch', 'ch'), ('handwriting', 'ch'), ('ch_server', 'ch'),
            ('chinese_cht', 'chinese_cht'), ('en', 'en'),
            ('japan', 'japan'), ('korean', 'korean'),
        )
        for model, expected_language in language_cases:
            with self.subTest(model=model):
                with patch.object(ocr_module.subprocess, 'run', capture_worker):
                    ocr_module.OCRManager()._ocr_batch(paths, model)
                script, data, kwargs = captures[-1]
                self.assertEqual(data['img_paths'], paths)
                self.assertEqual(data.get('ocr_model'), expected_language)
                self.assertEqual(kwargs.get('encoding'), 'utf-8')
                compile(script, '<generated OCR worker>', 'exec')
        self.assertEqual(len({script for script, _, _ in captures}), 1)

    def test_generated_worker_consumes_data_and_preserves_cjk_extension_text(self):
        observed = {}
        paths = ['C:/字图/uni20000_𠀀.png']

        class Capture(io.StringIO):
            def reconfigure(self, **kwargs):
                observed['stdout_encoding'] = kwargs.get('encoding')

        def create_ocr(**kwargs):
            observed['ocr_options'] = kwargs

            def recognize(image, cls=False):
                observed['image'] = image
                return [[[None, ['𠀀一', 0.98765]]]]

            return types.SimpleNamespace(ocr=recognize)

        def execute_safe_worker(args, **kwargs):
            # Only a whitelisted model is used. Heavy OCR dependencies are
            # replaced at the import boundary; generated code and JSON are real.
            script = Path(args[1]).read_text(encoding='utf-8')
            paddle = types.ModuleType('paddleocr')
            paddle.PaddleOCR = create_ocr
            pil = types.ModuleType('PIL')
            pil.Image = types.SimpleNamespace(open=lambda value: value)
            numpy = types.ModuleType('numpy')
            numpy.array = lambda value: value
            output = Capture()
            with patch.dict(sys.modules, {'paddleocr': paddle, 'PIL': pil,
                                          'numpy': numpy}), \
                    patch.object(sys, 'argv', args[1:]), \
                    patch.dict(os.environ, {}), \
                    contextlib.redirect_stdout(output):
                exec(compile(script, args[1], 'exec'), {})
            return types.SimpleNamespace(
                stdout=output.getvalue(), stderr='', returncode=0)

        with patch.object(ocr_module.subprocess, 'run', execute_safe_worker):
            result = ocr_module.OCRManager()._ocr_batch(paths, 'handwriting')
        self.assertEqual(observed['ocr_options'], {
            'lang': 'ch', 'use_gpu': False, 'show_log': False})
        self.assertEqual(observed['image'], paths[0])
        self.assertEqual(observed.get('stdout_encoding'), 'utf-8')
        self.assertEqual(result, [{
            'path': paths[0], 'text': '𠀀一', 'confidence': 0.9877}])


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    unittest.main()
