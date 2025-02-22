import { IconRotateClockwise } from '@tabler/icons-react';
import clsx from 'clsx';
import Image from 'next/image';
import React from 'react';
import { getUrl } from '../../../core/helpers/url-helpers';
import { Button } from '../Button';
import styles from './ErrorPage.module.scss';

interface IProps {
  error?: string;
  onRetry?: () => void;
  actionLabel?: string;
}

export const ErrorPage: React.FC<IProps> = ({ error, onRetry }) => (
  <div data-testid="error-page" className="card empty">
    <Image
      src={getUrl('error.png')}
      alt="Empty box"
      height="100"
      width="100"
      className={clsx(styles.emptyImage, 'mb-3 mt-2')}
      style={{
        maxWidth: '100%',
        height: 'auto',
      }}
    />
    <p className="empty-title">An error occured</p>
    <p className="empty-subtitle text-muted">{error}</p>
    <div className="empty-action">
      {onRetry && (
        <Button data-testid="error-page-action" onClick={onRetry} className="btn-danger">
          <IconRotateClockwise />
          Retry
        </Button>
      )}
    </div>
  </div>
);
