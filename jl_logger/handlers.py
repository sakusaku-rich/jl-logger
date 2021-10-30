import os
from jupyter_server.base.handlers import APIHandler
from jupyter_server.utils import url_path_join
import tornado

class LogAllOutputCellsHandler(APIHandler):

    @tornado.web.authenticated
    def post(self):
        input_data = self.get_json_body()
        log_contents = input_data['logContent']
        filename = input_data['filename']

        if filename.find('..') > -1 or filename.find('/') > -1 or filename.find('\\') > -1:
            raise ValueError('Invalid filename was entered.')
        else:
            dir = 'jllogger'
            if not os.path.exists(dir):
                os.mkdir(dir)
            with open(f'./{dir}/{filename}.log', 'a') as f:
                for c in log_contents:
                    f.write(c+'\n')


def setup_handlers(web_app, url_path):
    host_pattern = ".*$"
    base_url = web_app.settings["base_url"]
    route_pattern = url_path_join(base_url, url_path, 'LogOutputContent')
    handlers = [(route_pattern, LogAllOutputCellsHandler)]
    web_app.add_handlers(host_pattern, handlers)

