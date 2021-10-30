import { ToolbarButton } from '@jupyterlab/apputils';
import { NotebookActions } from '@jupyterlab/notebook';
import { DocumentRegistry } from '@jupyterlab/docregistry';
import { CodeCell } from '@jupyterlab/cells';
import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import {
  NotebookPanel,
  INotebookModel,
} from '@jupyterlab/notebook';
import { OutputArea } from '@jupyterlab/outputarea';
import { IDisposable, DisposableDelegate } from '@lumino/disposable';


import { requestAPI } from './handler';

const jlLoggerToolbarItemClassName: string = 'jl-logger-tools';
const activeJlLoggerBtnClassName: string = 'activated-jl-logger-btn';

/**
 * The plugin registration information.
 */
const jlLogger: JupyterFrontEndPlugin<void> = {
  id: 'jl-logger',
  autoStart: true,
  activate: (app: JupyterFrontEnd) => {
    app.docRegistry.addWidgetExtension('Notebook', new ButtonExtension);
  }
};

export class ButtonExtension
  implements DocumentRegistry.IWidgetExtension<NotebookPanel, INotebookModel>
{
  /**
   * Create a new extension for the notebook panel widget.
   *
   * @param panel Notebook panel
   * @param context Notebook context
   * @returns Disposable on the added button
   */
  createNew(
    panel: NotebookPanel,
    context: DocumentRegistry.IContext<INotebookModel>
  ): IDisposable {

    /**
     * Append hidden element for determining activity of jl-logger.
     * @param notebookId 
     */
    const appendJlLoggerHiddenElem = (notebookId: string) => {
      const e: HTMLInputElement = document.createElement('input');
      e.setAttribute('type', 'hidden');
      e.id = 'jl-logger-' + notebookId;
      e.value = '0';
      document.body.appendChild(e);
    };

    /**
     * Append text input and checkbox next to the jl-logger button
     * @param elem 
     * @param targetNotebookId 
     */
    const appendToolbarItems = (elem: Element, targetNotebookId: string) => {
      const parentSpanElem: Element = document.createElement('span');
      parentSpanElem.className = jlLoggerToolbarItemClassName;

      const textInputElem: Element = document.createElement('input');
      textInputElem.setAttribute('type', 'text');
      parentSpanElem.appendChild(textInputElem);

      const extSpanElem: Element = document.createElement('span');
      extSpanElem.textContent = '.log';
      extSpanElem.className = 'ext-txt';
      parentSpanElem.append(extSpanElem);

      const wandbLabelElem: Element = document.createElement('label');
      wandbLabelElem.textContent = 'W&B';
      wandbLabelElem.setAttribute('for', 'use-wandb-' + targetNotebookId);
      parentSpanElem.append(wandbLabelElem);

      const checkBoxElem: Element = document.createElement('input');
      checkBoxElem.setAttribute('type', 'checkbox');
      checkBoxElem.id = 'use-wandb-' + targetNotebookId;
      parentSpanElem.appendChild(checkBoxElem);

      elem.parentElement?.insertBefore(parentSpanElem, elem.nextSibling);
    };

    /**
     * switch activation of logger
     */
    const toggleActivation = () => {
      const e = window.event;
      const targetNotebookId = document.getElementsByClassName('jp-mod-current')[0].getAttribute('data-id') as string;

      let jlLoggerActivationElem = document.getElementById('jl-logger-' + targetNotebookId)
      if (jlLoggerActivationElem === null) {
        appendJlLoggerHiddenElem(targetNotebookId);
      }
      if (e !== undefined) {
        let elem = (e.target as Element);
        elem = elem.parentElement?.parentElement?.parentElement?.getElementsByClassName('jl-logger-btn')[0].parentElement as Element;
        elem.classList.toggle(activeJlLoggerBtnClassName);

        if (elem.classList.contains(activeJlLoggerBtnClassName)) {
          appendToolbarItems(elem, targetNotebookId);
          (document.getElementById('jl-logger-' + targetNotebookId) as HTMLInputElement).value = '1';
        } else {
          elem.parentElement?.getElementsByClassName(jlLoggerToolbarItemClassName)[0].remove();
          (document.getElementById('jl-logger-' + targetNotebookId) as HTMLInputElement).value = '0';
        }
      }
    };

    const button = new ToolbarButton({
      className: 'jl-logger-btn',
      label: 'Logger',
      onClick: toggleActivation,
      tooltip: 'Activate jl-logger',
    });

    panel.toolbar.insertItem(10, 'jl-logger', button);
    return new DisposableDelegate(() => {
      button.dispose();
    });
  }
}

/**
 * Post request for logging.
 * @param logContents 
 * @param filename 
 */
const postLog = async (logContents: Array<string>, filename: string) => {
  const dataToSend = {
    logContent: logContents,
    filename: filename
  };
  try {
    const reply = await requestAPI<any>(
      'LogOutputContent', {
      body: JSON.stringify(dataToSend),
      method: 'POST'
    });
    console.info(reply);
  } catch (reason) {
    console.error(
      `Error on POST /jl-logger/LogOutputContent ${dataToSend}.\n${reason}`
    );
  }
}

/**
 * Get string of current time.
 */
const getNowYMDhmsStr = () => {
  const date = new Date()
  const Y = date.getFullYear()
  const M = ("00" + (date.getMonth() + 1)).slice(-2)
  const D = ("00" + date.getDate()).slice(-2)
  const h = ("00" + date.getHours()).slice(-2)
  const m = ("00" + date.getMinutes()).slice(-2)

  return Y + M + D + h + m
}

/**
 * Get content in output cells from OutputArea
 * @param outputArea 
 * @returns 
 */
const getOutputContents = (outputArea: OutputArea) => {
  const outputJSONArray = outputArea.model.toJSON();
  return outputJSONArray.map((v) => {
    let outputType = v.output_type;
    let logContent = '';

    switch (outputType) {
      case 'stream':
        logContent = '[' + outputType + ']' + '\n' + v.text;
        break;
      case 'execute_result':
        let data: { [index: string]: any; } = v.data as Object
        let key = 'text/plain';
        if (Object.keys(data).includes(key)) {
          logContent = '[' + outputType + ']' + '\n' + data[key] + '\n';
        }
        break;
      case 'error':
        logContent = '[' + outputType + ']' + '\n' + v.evalue + '\n';
        break;
    }
    return logContent;
  });
}

/**
 * Extract wandb run name from OutputArea
 * @param outputArea 
 * @returns 
 */
const extractWandbRunName = (outputArea: OutputArea) => {
  const outputJSONArray = outputArea.model.toJSON();
  let runName: string = '';
  let re = /(?<=<strong><a href="https:\/\/wandb\.ai\/.*>).*(?=.*<\/a><\/strong>)/;
  for (let v of outputJSONArray) {
    if (v.output_type === 'display_data') {
      let data: { [index: string]: any; } = v.data as Object
      let key = 'text/html';
      if (Object.keys(data).includes(key)) {
        let res = re.exec(data[key])
        if (res !== null) {
          for (let s of res) {
            runName = s;
          }
        }
      }
    }
  }
  return runName;
}


NotebookActions.executed.connect((_, action) => {
  const targetOutputArea = (action.cell as any as CodeCell).outputArea;
  const outputContents = getOutputContents(targetOutputArea);
  const targetNotebookId = document.getElementsByClassName('jp-mod-current')[0].getAttribute('data-id') as string;
  const targetNotbeoolElem = document.getElementById(targetNotebookId) as Element;
  const activeFlagElem = (document.getElementById('jl-logger-' + targetNotebookId) as HTMLInputElement)
  if (activeFlagElem !== null && activeFlagElem.value === '1') {
    let specifiedFileName = (targetNotbeoolElem.getElementsByClassName(jlLoggerToolbarItemClassName)[0].getElementsByTagName('input')[0] as HTMLInputElement).value;
    if (specifiedFileName === '' || specifiedFileName === null || specifiedFileName === undefined) {
      if ((document.getElementById('use-wandb-' + targetNotebookId) as HTMLInputElement).checked) {
        const runName = extractWandbRunName(targetOutputArea);
        if (runName === null) {
          specifiedFileName = getNowYMDhmsStr();
        } else {
          (targetNotbeoolElem.getElementsByClassName(jlLoggerToolbarItemClassName)[0].getElementsByTagName('input')[0] as HTMLInputElement).value = runName;
          specifiedFileName = runName;
        }
      }else{
        specifiedFileName = getNowYMDhmsStr();
      }
    }
    postLog(outputContents, specifiedFileName);
  }
});

export default jlLogger;